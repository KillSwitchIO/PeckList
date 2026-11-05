// The client side of server sync (spec: Data Model & Sync). Local-first: every change lands in
// the workspace store first; this engine pushes what the server has not acknowledged and pulls
// what changed elsewhere, merging with the same rules as the server. Device-local progress (the
// cursor and the per-entity acks) lives in storage metadata, never in the workspace.

import { createStore, type StoreApi } from 'zustand/vanilla';
import { messageOf } from '../../core/errors.ts';
import { parseJson } from '../../core/io.ts';
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
import type { Attachment, WorkspaceFile } from '../../core/types.ts';
import { createMemoryBlobs } from '../../adapters/memory-blobs.ts';
import type { BlobStore } from '../../ports/blobs.ts';
import { createWorkspace, emptyEntities } from '../../core/workspace.ts';
import type { StorageAdapter } from '../../ports/storage.ts';
import {
  SyncFailure,
  type Account,
  type LoginOutcome,
  type SignUpOutcome,
  type PasswordOutcome,
  type ServerInfo,
  type SyncTransport,
} from '../../ports/sync.ts';
import type { WorkspaceStore } from '../store/workspaceStore.ts';
import { noteTiming } from '../telemetry/usage.ts';

/** What signing out did: done, or stopped by changes the server has not taken yet. */
export type SignOutOutcome =
  { kind: 'signed-out'; redirect: string | null } | { kind: 'unsynced'; count: number };

/**
 * Where this device stands with a server:
 * - `standalone`: no server here (a static PWA); nothing to do.
 * - `checking`: asking the server who we are.
 * - `signed-out`: the server needs a login.
 * - `password-change`: signed in, but the password must change before anything else.
 * - `ready`: signed in (or no login needed) and syncing.
 */
/**
 * `join-question`: signed in with tasks not yet in the account (the device's own on a first
 * sign-in, or a phone's handed over on connecting); see `join` and `answerJoin`.
 */
export type SyncPhase =
  'standalone' | 'checking' | 'signed-out' | 'password-change' | 'join-question' | 'ready';

/**
 * Where the tasks the join question asks about are: `device`, this device's own storage (a first
 * sign-in, audit W5); `phone`, the Android app's "this device only" tasks, handed over on
 * connecting (PL-070).
 */
export type JoinSource = 'device' | 'phone';

/** How answering went: `newer` and `invalid` leave the phone's tasks where they are. */
export type JoinOutcome = 'ok' | 'newer' | 'invalid';

/** The Android app's handed-over tasks (shell api 6), for the join question. */
export interface PhoneTasks {
  /** The workspace file handed over, or null. */
  peek(): Promise<string | null>;
  clear(): Promise<void>;
  /** The undo label for adding them. */
  label: string;
}

/** How the last sync went, for the indicator. */
export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error' | 'app-update' | 'server-behind';

export interface SyncState {
  /** The server connection, for friend links and lookups (unused without a server). */
  readonly transport: SyncTransport;
  /** This device's attached files, by SHA-256. */
  readonly blobs: BlobStore;
  phase: SyncPhase;
  status: SyncStatus;
  account: Account | null;
  /** What the join question is about, while asking; null otherwise. */
  join: JoinSource | null;
  /** What the server said about itself at start (its version and time zone); null without one. */
  server: ServerInfo | null;
  /** When the last sync finished (ms since epoch). */
  lastSynced: number | null;
  /** What went wrong last, when status is error. */
  error: string | null;
  /**
   * What the server took back since the person last looked: changes it refused (undone here) and
   * shared lists this account lost. Null when there is nothing to say.
   */
  notice: SyncNotice | null;

  start(): Promise<void>;
  signIn(username: string, password: string): Promise<LoginOutcome>;
  /** Sign in with what the browser's passkey prompt answered for a server ceremony (PL-123). */
  signInWithPasskey(ceremony: string, credential: unknown): Promise<LoginOutcome>;
  /** Make an account (open sign-up, or with an invite link) and sign in to it. */
  signUp(username: string, password: string, invite?: string): Promise<SignUpOutcome>;
  /**
   * Sign out and forget this device's copy (audit W1). Changes the server has not taken yet stop
   * it (`unsynced`) unless `discard` says to lose them. Signed out, it resolves to the provider's
   * end-session address when that session should end too.
   */
  signOut(options?: { discard?: boolean }): Promise<SignOutOutcome>;
  changePassword(current: string, next: string): Promise<PasswordOutcome>;
  /** Sync now (push, then pull until caught up). Resolves when done or failed. */
  syncNow(): Promise<void>;
  /**
   * The first sign-in on a device that has tasks or lists of its own (perhaps someone else's, on a
   * shared computer, audit W5): `keep` adds them to the account, otherwise they leave this device
   * and it starts from what the account has. For a phone's handed-over tasks (`join` is `phone`),
   * `keep` adds them and leaving them out keeps them on the phone, untouched.
   */
  answerJoin(keep: boolean): Promise<JoinOutcome>;
  /** Stop timers and listeners. */
  stop(): void;
  dismissNotice(): void;
}

/** How soon a tab whose server did not answer at the first load asks again, and the longest wait. */
export const FIRST_LOAD_RETRY_MS = 5_000;
export const FIRST_LOAD_RETRY_MAX_MS = 60_000;

export interface SyncNotice {
  /** How many of this device's changes the server refused. */
  refused: number;
  /** Names of shared lists that are no longer this account's to see. */
  lostLists: string[];
  /** Files the server would not take (too large): they stay on this device only. */
  filesKept?: string[];
  /** Files that wait: the server takes no more uploads from this person today. Said once a session. */
  filesWaiting?: string[];
  /**
   * Changes the server could not take as they are (malformed, or stamped too far ahead): kept on
   * this device, not sent again until they change.
   */
  setAside?: number;
  /** This device's clock is well ahead of or behind the server's. Said once per session. */
  clock?: 'ahead' | 'behind';
}

/** Device-local sync progress, kept under storage metadata `sync`. */
export interface SyncMeta {
  /** The account this device's workspace belongs to; null before the first link. */
  account: string | null;
  cursor: number;
  acks: Acks;
  /** The server data's epoch last seen (null before one was seen). */
  epoch?: string | null;
}

export interface SyncEngineDependencies {
  transport: SyncTransport;
  /** This device's id as the transport sends it; its own change events are skipped. */
  device?: string;
  workspace: WorkspaceStore;
  storage: StorageAdapter;
  /** Where this device keeps attached files (memory when absent). */
  blobs?: BlobStore;
  now?: () => number;
  /** One sync at a time across tabs (Web Locks). Defaults to running directly. */
  withLock?: <T>(run: () => Promise<T>) => Promise<T>;
  /** Quiet time after a local change before syncing it. */
  debounceMs?: number;
  /** How often to sync while the app is open. */
  intervalMs?: number;
  /**
   * Only look (a super admin viewing as someone, audit C4): start from nothing but what the
   * account has on the server, and never push. Nothing made on this tab reaches their account.
   */
  readOnly?: boolean;
  /**
   * After a sign-out has forgotten the data: what else this device should drop (its Web Push
   * subscription, alarms set ahead in the Android app).
   */
  onSignedOut?: () => Promise<void>;
  /** The Android app's handed-over tasks (absent in a browser). */
  phoneTasks?: PhoneTasks;
}

const META = 'sync';
/** A sign-out that could not reach the server: its session ends at the next start that can. */
const LOGOUT_OWED = 'logoutOwed';
/**
 * A sync still running this long after it began, when another is asked for, is taken as lost (a
 * request that died while the page was paused, a lock never released) and a fresh one starts;
 * whatever the lost one still does is ignored (the drill of 2026-10-29).
 */
export const STALE_SYNC_MS = 60_000;

/** How far this device's clock may be from the server's before the person is told. */
const CLOCK_TOLERANCE_MS = 5 * 60_000;
/** Changes per request; more go out in the next round of the same sync. */
const BATCH = 1000;
/** Rounds per sync, so a server that always says "more" cannot spin forever. */
const MAX_ROUNDS = 50;
/**
 * A run of pages that only bring data (a first sync) is taken in together, up to this many
 * entities or this long, rather than page by page: one render and one save instead of one each
 * (R-FB-94; a 4,500-task first sync spent 2 s doing that work nine times over).
 */
const HOLD_ENTITIES = 5000;
const HOLD_MS = 1500;

export type SyncEngine = StoreApi<SyncState>;

/**
 * Lists `me` left on this device (node): their own membership, or their membership of a group
 * the list is shared with, was ended here. Losing those is no news to them.
 */
export function leftHere(workspace: WorkspaceFile, me: string, node: string): Set<string> {
  const here = (entity: { deletedAt: string | null; _hlc: Record<string, string> }) =>
    entity.deletedAt !== null && (entity._hlc.deletedAt ?? '').endsWith(`-${node}`);
  const left = new Set<string>();
  const groupsLeft = new Set<string>();
  for (const member of workspace.entities.groupMembers) {
    if (member.userId === me && here(member)) groupsLeft.add(member.groupId);
  }
  for (const member of workspace.entities.listMembers) {
    if (member.principal === `user:${me}` && here(member)) left.add(member.listId);
    if (member.principal.startsWith('group:') && groupsLeft.has(member.principal.slice(6))) {
      left.add(member.listId);
    }
  }
  return left;
}

/** Tasks, lists or tags the person made on this device (a fresh workspace has only its Mess Drawer). */
export function hasOwnData(workspace: WorkspaceFile): boolean {
  const { tasks, lists, tags } = workspace.entities;
  return (
    tasks.some((task) => task.deletedAt === null) ||
    lists.some((list) => list.deletedAt === null && !list.isInbox) ||
    tags.some((tag) => tag.deletedAt === null)
  );
}

export function createSyncEngine(deps: SyncEngineDependencies): SyncEngine {
  const now = deps.now ?? Date.now;
  const withLock = deps.withLock ?? ((run) => run());
  const debounceMs = deps.debounceMs ?? 1500;
  const intervalMs = deps.intervalMs ?? 30_000;
  const blobs = deps.blobs ?? createMemoryBlobs();
  const { transport, workspace, storage } = deps;
  let running: Promise<void> | null = null;
  let runningSince = 0;
  // Counts the syncs started: a sync given up on must not touch the state of the one after it.
  let generation = 0;
  let again = false;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;
  let closeEvents: (() => void) | null = null;
  let eventDebounce: ReturnType<typeof setTimeout> | null = null;
  // Changes this engine makes itself must not schedule another sync.
  let absorbing = false;
  // An off clock is said once per session, not after every sync.
  let clockSaid = false;

  const loadMeta = async (): Promise<SyncMeta> => {
    const stored = (await storage.loadMeta(META)) as Partial<SyncMeta> | null;
    return {
      account: stored?.account ?? null,
      cursor: stored?.cursor ?? 0,
      acks: stored?.acks ?? {},
      epoch: stored?.epoch ?? null,
    };
  };

  const saveMeta = (meta: SyncMeta) => storage.saveMeta(META, meta);

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
    const pullAll = async (): Promise<{
      changes: SyncChange[];
      cursor: number;
      epoch: string | null;
    }> => {
      const changes: SyncChange[] = [];
      let cursor = 0;
      let epoch: string | null = null;
      for (let round = 0; round < MAX_ROUNDS * 10; round += 1) {
        const page = await transport.sync({
          schemaVersion: CURRENT_SCHEMA_VERSION,
          cursor,
          changes: [],
        });
        changes.push(...page.changes);
        cursor = page.cursor;
        epoch = page.epoch ?? null;
        if (!page.more) break;
      }
      return { changes, cursor, epoch };
    };

    /** Replace this device's copy with what the account has on the server now. */
    const startOver = async (account: Account) => {
      const { changes, cursor, epoch } = await pullAll();
      const fresh = createWorkspace(workspace.getState().context());
      await workspace.getState().reset(joinAccount(fresh, account.id, changes));
      await saveMeta({ account: account.id, cursor, acks: acknowledge({}, changes), epoch });
    };

    /**
     * Make this device's workspace the account's. First link: the device's own data joins the
     * account. Another account than before: start over from what that account has.
     */
    const link = async (account: Account) => {
      const meta = await loadMeta();
      if (meta.account === account.id) return;
      await workspace.getState().flush();
      if (!workspace.getState().workspace) return;
      if (meta.account !== null) {
        // Someone else's data must not mix into this account.
        await startOver(account);
        return;
      }
      const { changes, cursor, epoch } = await pullAll();
      if (deps.readOnly) {
        // None of the starter lists, settings or profile this tab made may pass for theirs.
        const current = workspace.getState().workspace!;
        await workspace
          .getState()
          .reset(
            mergeRemote({ ...current, owner: account.id, entities: emptyEntities() }, changes),
          );
      } else {
        absorb((local) => joinAccount(local, account.id, changes));
      }
      await saveMeta({ account: account.id, cursor, acks: acknowledge({}, changes), epoch });
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
      set({ status: 'error', error: messageOf(error) });
    };

    /** Add to what the person is told next (the notice toast), on top of what waits already. */
    const tell = (news: {
      refused?: number;
      lostLists?: string[];
      filesKept?: string[];
      filesWaiting?: string[];
      setAside?: number | undefined;
      clock?: 'ahead' | 'behind' | undefined;
    }) => {
      const before = get().notice;
      set({
        notice: {
          ...before,
          refused: (before?.refused ?? 0) + (news.refused ?? 0),
          lostLists: [...(before?.lostLists ?? []), ...(news.lostLists ?? [])],
          ...(news.filesKept
            ? { filesKept: [...(before?.filesKept ?? []), ...news.filesKept] }
            : {}),
          ...(news.filesWaiting
            ? { filesWaiting: [...(before?.filesWaiting ?? []), ...news.filesWaiting] }
            : {}),
          ...(news.setAside ? { setAside: (before?.setAside ?? 0) + news.setAside } : {}),
          ...(news.clock ? { clock: news.clock } : {}),
        },
      });
    };

    // Files the server has (or refused), so each is asked about once per session.
    const onServer = new Set<string>();
    const refusedFiles = new Set<string>();
    // Files told about as waiting for the daily allowance, so it is said once.
    const toldWaiting = new Set<string>();
    /**
     * The batch, with each new attachment's file sent first, so no device ever learns of a file
     * the server cannot hand out. One the server refuses (too large) stays out of the batch and
     * on this device only; the person is told once.
     */
    const withFiles = async (batch: SyncChange[]): Promise<SyncChange[]> => {
      const files = transport.files;
      if (!files) return batch;
      const kept: SyncChange[] = [];
      const tooLarge: string[] = [];
      const waiting: string[] = [];
      for (const change of batch) {
        const attachment =
          change.collection === 'attachments' ? (change.entity as Attachment) : null;
        if (!attachment || attachment.deletedAt !== null || onServer.has(attachment.sha256)) {
          kept.push(change);
          continue;
        }
        if (refusedFiles.has(attachment.sha256)) continue;
        if (await files.has(attachment.sha256)) {
          onServer.add(attachment.sha256);
          kept.push(change);
          continue;
        }
        const blob = await blobs.get(attachment.sha256);
        // Not here (renamed on this device, added on another): the server judges.
        if (!blob) {
          kept.push(change);
          continue;
        }
        const outcome = await files.upload(attachment.sha256, blob);
        if (outcome === 'stored') {
          onServer.add(attachment.sha256);
          kept.push(change);
        } else if (outcome === 'later') {
          // Over today's allowance: it stays queued and goes at a later sync.
          if (!toldWaiting.has(attachment.sha256)) {
            toldWaiting.add(attachment.sha256);
            waiting.push(attachment.name);
          }
        } else {
          refusedFiles.add(attachment.sha256);
          tooLarge.push(attachment.name);
        }
      }
      if (tooLarge.length > 0) tell({ filesKept: tooLarge });
      if (waiting.length > 0) tell({ filesWaiting: waiting });
      return kept;
    };

    /**
     * Whether this device's clock is off: the server set a change aside for being stamped too far
     * ahead, or its time differs from the device's by more than a few minutes. Changes stamped
     * ahead win every merge until the time catches up; ones stamped behind lose.
     */
    const clockOff = (response: {
      invalid?: { code: string }[];
      serverTime?: string | null;
    }): 'ahead' | 'behind' | undefined => {
      if (response.invalid?.some((each) => each.code === 'clock_drift')) return 'ahead';
      const server = response.serverTime ? Date.parse(response.serverTime) : NaN;
      if (Number.isNaN(server)) return undefined;
      const skew = now() - server;
      if (skew > CLOCK_TOLERANCE_MS) return 'ahead';
      if (skew < -CLOCK_TOLERANCE_MS) return 'behind';
      return undefined;
    };

    /** One sync: push batches and pull pages until both sides are caught up. */
    const cycle = async () => {
      set({ status: 'syncing' });
      await withLock(async () => {
        const account = get().account;
        if (!account) return;
        await link(account);
        let meta = await loadMeta();
        // Pages pulled but not taken in yet, and where the sync stands once they are.
        let held = null as { changes: SyncChange[]; since: number; meta: SyncMeta } | null;
        const takeInHeld = async () => {
          if (!held) return;
          const { changes, meta: after } = held;
          held = null;
          absorb((local) => mergeRemote(local, changes, []));
          await saveMeta(after);
        };
        for (let round = 0; round < MAX_ROUNDS; round += 1) {
          await workspace.getState().flush();
          const current = workspace.getState().workspace;
          if (!current) return;
          const pending = deps.readOnly ? [] : pendingChanges(current, meta.acks);
          const batch = await withFiles(pending.slice(0, BATCH));
          const asked = performance.now();
          const response = await transport.sync({
            schemaVersion: CURRENT_SCHEMA_VERSION,
            cursor: meta.cursor,
            changes: batch,
            epoch: meta.epoch ?? null,
          });
          noteTiming('sync', performance.now() - asked);
          // The server's data was restored from a backup: it took none of this request's changes
          // (they belong to the data before), and this device starts over from what it has now.
          if (response.epoch && meta.epoch && response.epoch !== meta.epoch) {
            held = null;
            await startOver(account);
            break;
          }
          const revoked = new Set(response.revoked);
          const acks = Object.fromEntries(
            Object.entries(acknowledge(acknowledge(meta.acks, batch), response.changes)).filter(
              ([id]) => !revoked.has(id),
            ),
          );
          const next: SyncMeta = {
            account: account.id,
            cursor: response.cursor,
            acks,
            epoch: response.epoch ?? meta.epoch ?? null,
          };
          // Only data, and more to come: hold it (the first page always goes in at once, so the
          // lists fill straight away). Held pages skip the notices below; nothing they could raise
          // (refusals, revocations, set-asides) can be on them, and the clock check runs on the
          // last page, which always goes through.
          const onlyData =
            batch.length === 0 &&
            revoked.size === 0 &&
            !response.rejected?.length &&
            !response.corrections?.length &&
            !response.invalid?.length;
          if (onlyData && response.more && round > 0) {
            const since: number = held?.since ?? now();
            held = { changes: [...(held?.changes ?? []), ...response.changes], since, meta: next };
            meta = next;
            if (held.changes.length >= HOLD_ENTITIES || now() - since >= HOLD_MS) {
              await takeInHeld();
            }
            continue;
          }
          await takeInHeld();
          const lost: string[] = [];
          absorb(
            (local) => {
              // Lists this person left here, or whose group they left here, go without a word.
              const left = leftHere(local, account.id, workspace.getState().context().clock.node);
              for (const list of local.entities.lists) {
                if (revoked.has(list.id) && list.deletedAt === null && !left.has(list.id)) {
                  lost.push(list.name);
                }
              }
              return applyRejections(
                mergeRemote(local, response.changes, response.revoked),
                response.rejected ?? [],
                response.corrections ?? [],
              );
            },
            // Refused and revoked entities must not come back from this device's stored copy.
            [...(response.rejected ?? []), ...response.revoked],
          );
          const refused = response.rejected?.length ?? 0;
          // Set aside by the server: acknowledged with the batch above, so they are not sent
          // again (and cannot hold up everything after them) until they change here.
          const setAside = response.invalid?.length ?? 0;
          const clock = clockSaid ? undefined : clockOff(response);
          if (clock) clockSaid = true;
          if (refused > 0 || lost.length > 0 || setAside > 0 || clock) {
            tell({ refused, lostLists: lost, setAside, clock });
          }
          await saveMeta(next);
          meta = next;
          if (!response.more && pending.length <= BATCH) break;
        }
        await takeInHeld();
      });
      set({ status: 'idle', lastSynced: now(), error: null });
      if (!closeEvents) openEvents();
    };

    const syncNow = async (): Promise<void> => {
      if (get().phase !== 'ready') return;
      if (running && now() - runningSince < STALE_SYNC_MS) {
        // One at a time; a request during a sync runs once more right after it.
        again = true;
        return running;
      }
      // Nothing running, or a sync that has hung past its time: start afresh.
      const mine = ++generation;
      runningSince = now();
      running = (async () => {
        try {
          do {
            again = false;
            await cycle();
          } while (again && mine === generation);
        } catch (error) {
          if (mine === generation) fail(error);
        } finally {
          if (mine === generation) {
            running = null;
            // A request that came in while this one failed still wants its sync.
            if (again) {
              again = false;
              void syncNow();
            }
          }
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
      // Tasks the phone made without a server, handed over on connecting: ask about them first.
      const handed = await deps.phoneTasks?.peek().catch(() => null);
      if (handed) {
        set({ phase: 'join-question', join: 'phone', account, status: 'idle' });
        return;
      }
      // Never linked, and data on the device already: ask before it goes into this account.
      const current = workspace.getState().workspace;
      if (current && hasOwnData(current) && (await loadMeta()).account === null) {
        set({ phase: 'join-question', join: 'device', account, status: 'idle' });
        return;
      }
      set({ phase: 'ready', join: null, account, status: 'idle' });
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

    // A server that did not answer at the first load (a restart, a flaky network) is asked again,
    // so the tab does not stay standalone until it is reloaded (audit C5): after 5 s, then twice as
    // long each time up to a minute, and as soon as the browser is back online. A host that is no
    // PeckList server at all (no info) stays standalone for good.
    let firstLoad: ReturnType<typeof setTimeout> | null = null;
    let firstLoadDelay = FIRST_LOAD_RETRY_MS;
    const retryFirstLoad = () => {
      if (get().phase === 'standalone') void get().start();
    };
    const askAgainLater = () => {
      if (firstLoad) clearTimeout(firstLoad);
      firstLoad = setTimeout(() => {
        firstLoad = null;
        retryFirstLoad();
      }, firstLoadDelay);
      firstLoadDelay = Math.min(firstLoadDelay * 2, FIRST_LOAD_RETRY_MAX_MS);
      if (typeof window !== 'undefined') window.addEventListener('online', retryFirstLoad);
    };
    const stopAskingAgain = () => {
      if (firstLoad) clearTimeout(firstLoad);
      firstLoad = null;
      if (typeof window !== 'undefined') window.removeEventListener('online', retryFirstLoad);
    };

    return {
      transport,
      blobs,
      phase: 'checking',
      status: 'idle',
      account: null,
      join: null,
      server: null,
      lastSynced: null,
      error: null,
      notice: null,

      dismissNotice() {
        set({ notice: null });
      },

      async start() {
        try {
          const info = await transport.info();
          stopAskingAgain();
          if (!info) {
            set({ phase: 'standalone' });
            return;
          }
          set({ server: info });
          if (info.schemaVersion !== CURRENT_SCHEMA_VERSION) {
            // Keep working locally; the indicator says why nothing syncs.
            set({
              phase: 'ready',
              status: info.schemaVersion > CURRENT_SCHEMA_VERSION ? 'app-update' : 'server-behind',
            });
            return;
          }
          listen();
          if ((await storage.loadMeta(LOGOUT_OWED)) === true) {
            await transport.logout();
            await storage.saveMeta(LOGOUT_OWED, false);
          }
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
            askAgainLater();
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

      async signInWithPasskey(ceremony, credential) {
        if (!transport.passkeySignIn) return { kind: 'invalid' };
        const outcome = await transport.passkeySignIn(ceremony, credential);
        if (outcome.kind === 'ok') await enter(outcome.account);
        return outcome;
      },

      async signUp(username, password, invite) {
        if (!transport.signUp) return { kind: 'closed' };
        const outcome = await transport.signUp(username, password, invite);
        if (outcome.kind === 'ok') await enter(outcome.account);
        return outcome;
      },

      async signOut(options = {}) {
        await get()
          .syncNow()
          .catch(() => undefined);
        // Forgetting the device's copy must not lose work the server never got.
        const current = workspace.getState().workspace;
        const unsynced = current ? pendingChanges(current, (await loadMeta()).acks).length : 0;
        if (unsynced > 0 && !options.discard) return { kind: 'unsynced', count: unsynced };
        let reached = true;
        const answer = await transport.logout().catch(() => {
          reached = false;
          return undefined;
        });
        closeEventStream();
        // Nothing of the person stays readable here, online or off (audit W1).
        await workspace.getState().forget();
        // Offline, the server never heard: its session (an HttpOnly cookie) would sign the next
        // person on this device straight back in, so it ends at the next start.
        if (!reached) await storage.saveMeta(LOGOUT_OWED, true);
        await blobs.clear().catch(() => undefined);
        await deps.onSignedOut?.().catch(() => undefined);
        set({ phase: 'signed-out', account: null, status: 'idle', notice: null });
        return { kind: 'signed-out', redirect: answer?.redirect ?? null };
      },

      async changePassword(current, next) {
        const outcome = await transport.changePassword(current, next);
        if (outcome.kind === 'ok') await enter(outcome.account);
        return outcome;
      },

      syncNow,

      async answerJoin(keep) {
        const account = get().account;
        if (!account || get().phase !== 'join-question') return 'ok';
        if (get().join === 'phone') {
          if (keep) {
            const handed = await deps.phoneTasks?.peek().catch(() => null);
            const parsed = handed ? parseJson(handed) : null;
            if (!parsed?.ok) return 'invalid';
            const outcome = workspace
              .getState()
              .importDocument(parsed.value, deps.phoneTasks?.label ?? 'Tasks from this phone');
            if (outcome.kind === 'newer' || outcome.kind === 'invalid') return outcome.kind;
          }
          await deps.phoneTasks?.clear().catch(() => undefined);
          set({ join: null });
          // Left on the phone: this device's own tasks may still need asking about.
          if (!keep) {
            await enter(account);
            return 'ok';
          }
          set({ phase: 'ready', status: 'idle' });
          openEvents();
          await syncNow();
          return 'ok';
        }
        if (!keep) {
          try {
            await withLock(() => startOver(account));
          } catch (error) {
            fail(error);
            return 'ok';
          }
        }
        set({ phase: 'ready', join: null, status: 'idle' });
        openEvents();
        await syncNow();
        return 'ok';
      },

      stop() {
        stopAskingAgain();
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
