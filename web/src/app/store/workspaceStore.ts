// The domain store: the single place the UI reads and writes the workspace. Every change runs
// a pure core operation, lands in memory first, then persists (debounced) through the
// StorageAdapter with a read-merge-write so several tabs never overwrite each other.

import { createStore, type StoreApi } from 'zustand/vanilla';
import { maxHlc } from '../../core/collections.ts';
import { HlcClock } from '../../core/hlc.ts';
import { openDocument, upgradeDocument, type OpenResult } from '../../core/io.ts';
import { backupName } from '../../core/migrations.ts';
import { mergeWorkspaces } from '../../core/merge.ts';
import type { OpContext } from '../../core/ops.ts';
import type { WorkspaceFile } from '../../core/types.ts';
import { revertChange } from '../../core/undo.ts';
import { createWorkspace } from '../../core/workspace.ts';
import type { IdGenerator } from '../../ports/ids.ts';
import type { StorageAdapter } from '../../ports/storage.ts';
import type { SchemaValidator } from '../../ports/validator.ts';

export type Operation = (ctx: OpContext, workspace: WorkspaceFile) => WorkspaceFile;

export interface UndoEntry {
  id: number;
  label: string;
  before: WorkspaceFile;
  after: WorkspaceFile;
}

export type StoreStatus = 'loading' | 'ready' | 'needs-upgrade' | 'needs-app-update' | 'error';

export interface WorkspaceState {
  status: StoreStatus;
  workspace: WorkspaceFile | null;
  /** Details when status is needs-upgrade, needs-app-update or error */
  problem: OpenResult | { kind: 'error'; message: string } | null;
  undoStack: UndoEntry[];
  /** The most recent undoable action, for the undo toast */
  lastUndoable: UndoEntry | null;
  saving: boolean;

  init(): Promise<void>;
  /** Back up the stored data, then upgrade it to this app's schema (status needs-upgrade). */
  upgrade(): Promise<void>;
  /** Run an operation. With a label it becomes undoable ("Task completed"). */
  apply(operation: Operation, label?: string): void;
  undo(id?: number): void;
  dismissUndo(): void;
  /** Persist now (also called on page hide). */
  flush(): Promise<void>;
  /** Merge in whatever another tab saved. */
  reloadFromStorage(): Promise<void>;
  /**
   * Take in a change that did not happen here (data from the server, a device joining an
   * account): no undo entry, no new clocks. The workspace may come back under another owner.
   */
  absorb(transform: (workspace: WorkspaceFile) => WorkspaceFile): void;
  /** Replace the workspace outright (signing in as someone else on this device). */
  reset(workspace: WorkspaceFile): Promise<void>;
  context(): OpContext;
}

export interface StoreDependencies {
  storage: StorageAdapter;
  validator: SchemaValidator;
  ids: IdGenerator;
  node: string;
  now?: () => number;
  saveDelayMs?: number;
  /** Serialize saves across tabs (Web Locks). Defaults to running directly. */
  withLock?: <T>(run: () => Promise<T>) => Promise<T>;
  /** Tell other tabs a save happened. */
  notify?: () => void;
  displayName?: string;
}

const UNDO_LIMIT = 50;

export type WorkspaceStore = StoreApi<WorkspaceState>;

export function createWorkspaceStore(deps: StoreDependencies): WorkspaceStore {
  const now = deps.now ?? Date.now;
  const delay = deps.saveDelayMs ?? 400;
  const withLock = deps.withLock ?? ((run) => run());
  const clock = new HlcClock({ node: deps.node, now });
  let ctx: OpContext | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;
  let nextUndoId = 1;
  // The owner of the copy in storage when this tab last read or wrote it: tells a join made here
  // (memory moved on) from one made in another tab (storage moved on).
  let storedOwner: string | null = null;

  const makeContext = (userId: string): OpContext => ({
    clock,
    ids: deps.ids,
    userId,
    origin: 'local',
    now,
  });

  const advanceClock = (workspace: WorkspaceFile) => {
    const newest = maxHlc(workspace);
    if (!newest) return;
    try {
      clock.receive(newest);
    } catch {
      // A copy stamped far in the future (bad device clock): keep our own time.
    }
  };

  /**
   * Merge a stored copy into memory, if it is readable. Copies under different owners never mix:
   * if this tab changed owner (it joined an account), its copy wins; if another tab did, the
   * stored copy wins and replaces this one.
   */
  const mergeStored = (stored: unknown, current: WorkspaceFile): WorkspaceFile => {
    if (stored === null) return current;
    const opened = openDocument(stored, deps.validator);
    if (opened.kind !== 'ok') return current;
    if (opened.workspace.owner !== current.owner) {
      if (current.owner !== storedOwner) return current;
      advanceClock(opened.workspace);
      ctx = makeContext(opened.workspace.owner);
      return opened.workspace;
    }
    advanceClock(opened.workspace);
    return mergeWorkspaces(current, opened.workspace);
  };

  const store = createStore<WorkspaceState>()((set, get) => {
    const persist = async () => {
      const { workspace } = get();
      if (!workspace) return;
      dirty = false;
      set({ saving: true });
      try {
        await withLock(async () => {
          const current = get().workspace ?? workspace;
          const merged = mergeStored(await deps.storage.load(), current);
          await deps.storage.save(merged);
          storedOwner = merged.owner;
          if (merged.owner !== current.owner) {
            set({ workspace: merged, undoStack: [], lastUndoable: null });
          } else {
            set({ workspace: merged });
          }
        });
        deps.notify?.();
      } finally {
        set({ saving: false });
      }
    };

    const schedule = () => {
      dirty = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void persist();
      }, delay);
    };

    return {
      status: 'loading',
      workspace: null,
      problem: null,
      undoStack: [],
      lastUndoable: null,
      saving: false,

      async init() {
        try {
          const raw = await deps.storage.load();
          if (raw === null) {
            const userId = deps.ids.next();
            ctx = makeContext(userId);
            const workspace = createWorkspace(
              ctx,
              deps.displayName ? { displayName: deps.displayName } : {},
            );
            set({ status: 'ready', workspace });
            storedOwner = workspace.owner;
            await persist();
            return;
          }
          const opened = openDocument(raw, deps.validator);
          if (opened.kind === 'ok') {
            advanceClock(opened.workspace);
            ctx = makeContext(opened.workspace.owner);
            storedOwner = opened.workspace.owner;
            set({ status: 'ready', workspace: opened.workspace });
          } else if (opened.kind === 'needs-upgrade') {
            set({ status: 'needs-upgrade', problem: opened });
          } else if (opened.kind === 'needs-app-update') {
            set({ status: 'needs-app-update', problem: opened });
          } else {
            set({ status: 'error', problem: opened });
          }
        } catch (error) {
          set({
            status: 'error',
            problem: {
              kind: 'error',
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
      },

      apply(operation, label) {
        const { workspace, undoStack } = get();
        if (!workspace || !ctx) throw new Error('workspace is not ready');
        const after = operation(ctx, workspace);
        if (after === workspace) return;
        if (label) {
          const entry: UndoEntry = { id: nextUndoId++, label, before: workspace, after };
          set({
            workspace: after,
            undoStack: [...undoStack, entry].slice(-UNDO_LIMIT),
            lastUndoable: entry,
          });
        } else {
          set({ workspace: after });
        }
        schedule();
      },

      undo(id) {
        const { workspace, undoStack } = get();
        if (!workspace || !ctx || undoStack.length === 0) return;
        const index =
          id === undefined ? undoStack.length - 1 : undoStack.findIndex((entry) => entry.id === id);
        if (index < 0) return;
        const entry = undoStack[index]!;
        const reverted = revertChange(ctx, entry.before, entry.after, workspace);
        set({
          workspace: reverted,
          undoStack: undoStack.filter((_, i) => i !== index),
          lastUndoable: null,
        });
        schedule();
      },

      dismissUndo() {
        set({ lastUndoable: null });
      },

      async upgrade() {
        const { status, problem } = get();
        if (status !== 'needs-upgrade' || problem?.kind !== 'needs-upgrade') return;
        try {
          await deps.storage.backup(backupName('workspace', problem.from), problem.document);
          const upgraded = upgradeDocument(problem.document, deps.validator);
          if (upgraded.kind !== 'ok') {
            set({ status: 'error', problem: upgraded });
            return;
          }
          await deps.storage.save(upgraded.workspace);
          storedOwner = upgraded.workspace.owner;
          advanceClock(upgraded.workspace);
          ctx = makeContext(upgraded.workspace.owner);
          set({ status: 'ready', workspace: upgraded.workspace, problem: null });
        } catch (error) {
          set({
            status: 'error',
            problem: {
              kind: 'error',
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
      },

      async flush() {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (dirty) await persist();
      },

      async reloadFromStorage() {
        const { workspace } = get();
        if (!workspace) return;
        const merged = mergeStored(await deps.storage.load(), workspace);
        if (merged === workspace) return;
        storedOwner = merged.owner;
        if (merged.owner !== workspace.owner) {
          set({ workspace: merged, undoStack: [], lastUndoable: null });
        } else {
          set({ workspace: merged });
        }
      },

      absorb(transform) {
        const { workspace } = get();
        if (!workspace) return;
        const next = transform(workspace);
        if (next === workspace) return;
        advanceClock(next);
        if (next.owner !== workspace.owner) {
          ctx = makeContext(next.owner);
          // Undo entries belong to the old owner's data.
          set({ workspace: next, undoStack: [], lastUndoable: null });
        } else {
          set({ workspace: next });
        }
        schedule();
      },

      async reset(workspace) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        dirty = false;
        advanceClock(workspace);
        ctx = makeContext(workspace.owner);
        set({ status: 'ready', workspace, undoStack: [], lastUndoable: null, problem: null });
        await withLock(() => deps.storage.save(workspace));
        storedOwner = workspace.owner;
        deps.notify?.();
      },

      context() {
        if (!ctx) throw new Error('workspace is not ready');
        return ctx;
      },
    };
  });
  return store;
}
