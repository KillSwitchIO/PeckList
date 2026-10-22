// The client side of server sync (spec: Data Model & Sync). Local-first: every change lands in
// the workspace store first; this engine pushes what the server has not acknowledged and pulls
// what changed elsewhere, merging with the same rules as the server. Device-local progress (the
// cursor and the per-entity acks) lives in storage metadata, never in the workspace.

import { createStore, type StoreApi } from 'zustand/vanilla';
import { CURRENT_SCHEMA_VERSION } from '../../core/migrations.ts';
import {
  acknowledge,
  applyRejections,
  joinAccount,
  mergeRemote,
  pendingChanges,
  type Acks,
  type SyncChange,
} from '../../core/sync.ts';
import type { WorkspaceFile } from '../../core/types.ts';
import { createWorkspace } from '../../core/workspace.ts';
import type { StorageAdapter } from '../../ports/storage.ts';
import {
  SyncFailure,
  type Account,
  type LoginOutcome,
  type PasswordOutcome,
  type SyncTransport,
} from '../../ports/sync.ts';
import type { WorkspaceStore } from '../store/workspaceStore.ts';

/**
 * Where this device stands with a server:
 * - `standalone`: no server here (a static PWA); nothing to do.
 * - `checking`: asking the server who we are.
 * - `signed-out`: the server needs a login.
 * - `password-change`: signed in, but the password must change before anything else.
 * - `ready`: signed in (or no login needed) and syncing.
 */
export type SyncPhase = 'standalone' | 'checking' | 'signed-out' | 'password-change' | 'ready';

/** How the last sync went, for the indicator. */
export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error' | 'app-update' | 'server-behind';

export interface SyncState {
  /** The server connection, for friend links and lookups (unused without a server). */
  readonly transport: SyncTransport;
  phase: SyncPhase;
  status: SyncStatus;
  account: Account | null;
  /** When the last sync finished (ms since epoch). */
  lastSynced: number | null;
  /** What went wrong last, when status is error. */
  error: string | null;

  start(): Promise<void>;
  signIn(username: string, password: string): Promise<LoginOutcome>;
  signOut(): Promise<void>;
  changePassword(current: string, next: string): Promise<PasswordOutcome>;
  /** Sync now (push, then pull until caught up). Resolves when done or failed. */
  syncNow(): Promise<void>;
  /** Stop timers and listeners. */
  stop(): void;
}

/** Device-local sync progress, kept under storage metadata `sync`. */
export interface SyncMeta {
  /** The account this device's workspace belongs to; null before the first link. */
  account: string | null;
  cursor: number;
  acks: Acks;
}

export interface SyncEngineDependencies {
  transport: SyncTransport;
  /** This device's id as the transport sends it; its own change events are skipped. */
  device?: string;
  workspace: WorkspaceStore;
  storage: StorageAdapter;
  now?: () => number;
  /** One sync at a time across tabs (Web Locks). Defaults to running directly. */
  withLock?: <T>(run: () => Promise<T>) => Promise<T>;
  /** Quiet time after a local change before syncing it. */
  debounceMs?: number;
  /** How often to sync while the app is open. */
  intervalMs?: number;
}

const META = 'sync';
/** Changes per request; more go out in the next round of the same sync. */
const BATCH = 1000;
/** Rounds per sync, so a server that always says "more" cannot spin forever. */
const MAX_ROUNDS = 50;

export type SyncEngine = StoreApi<SyncState>;

export function createSyncEngine(deps: SyncEngineDependencies): SyncEngine {
  const now = deps.now ?? Date.now;
  const withLock = deps.withLock ?? ((run) => run());
  const debounceMs = deps.debounceMs ?? 1500;
  const intervalMs = deps.intervalMs ?? 30_000;
  const { transport, workspace, storage } = deps;
  let running: Promise<void> | null = null;
  let again = false;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;
  let closeEvents: (() => void) | null = null;
  let eventDebounce: ReturnType<typeof setTimeout> | null = null;
  // Changes this engine makes itself must not schedule another sync.
  let absorbing = false;

  const loadMeta = async (): Promise<SyncMeta> => {
    const stored = (await storage.loadMeta(META)) as Partial<SyncMeta> | null;
    return {
      account: stored?.account ?? null,
      cursor: stored?.cursor ?? 0,
      acks: stored?.acks ?? {},
    };
  };

  const absorb = (
    transform: (local: WorkspaceFile) => WorkspaceFile,
    authoritative?: readonly string[],
  ) => {
    absorbing = true;
    try {
      workspace.getState().absorb(transform, authoritative);
    } finally {
      absorbing = false;
    }
  };

  const engine = createStore<SyncState>()((set, get) => {
    /** Pull every page from the start, pushing nothing (linking a device to an account). */
    const pullAll = async (): Promise<{ changes: SyncChange[]; cursor: number }> => {
      const changes: SyncChange[] = [];
      let cursor = 0;
      for (let round = 0; round < MAX_ROUNDS * 10; round += 1) {
        const page = await transport.sync({
          schemaVersion: CURRENT_SCHEMA_VERSION,
          cursor,
          changes: [],
        });
        changes.push(...page.changes);
        cursor = page.cursor;
        if (!page.more) break;
      }
      return { changes, cursor };
    };

    /**
     * Make this device's workspace the account's. First link: the device's own data joins the
     * account. Another account than before: start over from what that account has.
     */
    const link = async (account: Account) => {
      const meta = await loadMeta();
      if (meta.account === account.id) return;
      await workspace.getState().flush();
      const { changes, cursor } = await pullAll();
      const current = workspace.getState().workspace;
      if (!current) return;
      if (meta.account === null) {
        absorb((local) => joinAccount(local, account.id, changes));
      } else {
        // Someone else's data must not mix into this account.
        const fresh = createWorkspace(workspace.getState().context());
        await workspace.getState().reset(joinAccount(fresh, account.id, changes));
      }
      await storage.saveMeta(META, {
        account: account.id,
        cursor,
        acks: acknowledge({}, changes),
      } satisfies SyncMeta);
    };

    const fail = (error: unknown) => {
      if (error instanceof SyncFailure) {
        switch (error.kind) {
          case 'offline':
            set({ status: 'offline' });
            return;
          case 'signed-out':
            closeEventStream();
            set({ phase: 'signed-out', status: 'idle', account: null });
            return;
          case 'password-change':
            set({ phase: 'password-change', status: 'idle' });
            return;
          case 'schema':
            set({
              status:
                (error.serverSchemaVersion ?? 0) > CURRENT_SCHEMA_VERSION
                  ? 'app-update'
                  : 'server-behind',
              error: error.message,
            });
            return;
          default:
            set({ status: 'error', error: error.message });
            return;
        }
      }
      set({ status: 'error', error: error instanceof Error ? error.message : String(error) });
    };

    /** One sync: push batches and pull pages until both sides are caught up. */
    const cycle = async () => {
      set({ status: 'syncing' });
      await withLock(async () => {
        const account = get().account;
        if (!account) return;
        await link(account);
        for (let round = 0; round < MAX_ROUNDS; round += 1) {
          await workspace.getState().flush();
          const current = workspace.getState().workspace;
          if (!current) return;
          const meta = await loadMeta();
          const pending = pendingChanges(current, meta.acks);
          const batch = pending.slice(0, BATCH);
          const response = await transport.sync({
            schemaVersion: CURRENT_SCHEMA_VERSION,
            cursor: meta.cursor,
            changes: batch,
          });
          const revoked = new Set(response.revoked);
          const acks = Object.fromEntries(
            Object.entries(acknowledge(acknowledge(meta.acks, batch), response.changes)).filter(
              ([id]) => !revoked.has(id),
            ),
          );
          absorb(
            (local) =>
              applyRejections(
                mergeRemote(local, response.changes, response.revoked),
                response.rejected ?? [],
                response.corrections ?? [],
              ),
            // Refused and revoked entities must not come back from this device's stored copy.
            [...(response.rejected ?? []), ...response.revoked],
          );
          await storage.saveMeta(META, {
            account: account.id,
            cursor: response.cursor,
            acks,
          } satisfies SyncMeta);
          if (!response.more && pending.length <= BATCH) break;
        }
      });
      set({ status: 'idle', lastSynced: now(), error: null });
      if (!closeEvents) openEvents();
    };

    const syncNow = async (): Promise<void> => {
      if (get().phase !== 'ready') return;
      if (running) {
        // One at a time; a request during a sync runs once more right after it.
        again = true;
        return running;
      }
      running = (async () => {
        try {
          do {
            again = false;
            await cycle();
          } while (again);
        } catch (error) {
          fail(error);
        } finally {
          running = null;
        }
      })();
      return running;
    };

    /** Sync as soon as another device changes something (when the server can say so). */
    const openEvents = () => {
      closeEvents?.();
      closeEvents =
        transport.events?.((change) => {
          if (change.source !== null && change.source === deps.device) return;
          if (eventDebounce) clearTimeout(eventDebounce);
          eventDebounce = setTimeout(() => void syncNow(), 250);
        }) ?? null;
    };
    const closeEventStream = () => {
      closeEvents?.();
      closeEvents = null;
      if (eventDebounce) clearTimeout(eventDebounce);
    };

    const enter = async (account: Account) => {
      if (account.mustChangePassword) {
        set({ phase: 'password-change', account });
        return;
      }
      set({ phase: 'ready', account, status: 'idle' });
      openEvents();
      await syncNow();
    };

    const listen = () => {
      if (unsubscribe) return;
      // A local change: sync it once things are quiet.
      unsubscribe = workspace.subscribe((state, previous) => {
        if (absorbing || state.workspace === previous.workspace || !previous.workspace) return;
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => void syncNow(), debounceMs);
      });
      interval = setInterval(() => void syncNow(), intervalMs);
      if (typeof window !== 'undefined') {
        window.addEventListener('online', onWake);
        window.addEventListener('focus', onWake);
        document.addEventListener('visibilitychange', onWake);
      }
    };
    const onWake = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void syncNow();
    };

    return {
      transport,
      phase: 'checking',
      status: 'idle',
      account: null,
      lastSynced: null,
      error: null,

      async start() {
        try {
          const info = await transport.info();
          if (!info) {
            set({ phase: 'standalone' });
            return;
          }
          if (info.schemaVersion !== CURRENT_SCHEMA_VERSION) {
            // Keep working locally; the indicator says why nothing syncs.
            set({
              phase: 'ready',
              status: info.schemaVersion > CURRENT_SCHEMA_VERSION ? 'app-update' : 'server-behind',
            });
            return;
          }
          listen();
          const account = await transport.me();
          if (!account) {
            set({ phase: 'signed-out' });
            return;
          }
          await enter(account);
        } catch (error) {
          // No answer: a device that synced before keeps working offline and retries.
          const meta = await loadMeta().catch(() => null);
          if (error instanceof SyncFailure && error.kind === 'offline' && meta?.account) {
            listen();
            set({ phase: 'ready', status: 'offline' });
            return;
          }
          if (error instanceof SyncFailure && error.kind === 'offline') {
            set({ phase: 'standalone' });
            return;
          }
          fail(error);
        }
      },

      async signIn(username, password) {
        const outcome = await transport.login(username, password);
        if (outcome.kind === 'ok') await enter(outcome.account);
        return outcome;
      },

      async signOut() {
        await get()
          .syncNow()
          .catch(() => undefined);
        await transport.logout().catch(() => undefined);
        closeEventStream();
        set({ phase: 'signed-out', account: null, status: 'idle' });
      },

      async changePassword(current, next) {
        const outcome = await transport.changePassword(current, next);
        if (outcome.kind === 'ok') await enter(outcome.account);
        return outcome;
      },

      syncNow,

      stop() {
        closeEventStream();
        unsubscribe?.();
        unsubscribe = null;
        if (debounce) clearTimeout(debounce);
        if (interval) clearInterval(interval);
        if (typeof window !== 'undefined') {
          window.removeEventListener('online', onWake);
          window.removeEventListener('focus', onWake);
          document.removeEventListener('visibilitychange', onWake);
        }
      },
    };
  });
  return engine;
}
