import { useMemo, useSyncExternalStore } from 'react';
import { isNarrowed, narrowWorkspace, NO_NARROWING, type Narrowing } from '../../core/narrowing.ts';
import type { Id, WorkspaceFile } from '../../core/types.ts';
import { useToday } from '../hooks/useToday.ts';
import { useWorkspace } from '../store/hooks.ts';
import { NarrowButton } from './NarrowButton.tsx';

// What each view is narrowed to, kept on this device like the other view choices.
export type NarrowView = 'today' | 'upcoming' | 'calendar';

const keyOf = (view: NarrowView) => `pecklist.narrow.${view}`;
const listeners = new Set<() => void>();
const memory = new Map<string, string | null>();

function readRaw(view: NarrowView): string | null {
  try {
    return localStorage.getItem(keyOf(view));
  } catch {
    return memory.get(keyOf(view)) ?? null;
  }
}

function parse(raw: string | null): Narrowing {
  if (!raw) return NO_NARROWING;
  try {
    const saved = JSON.parse(raw) as Partial<Narrowing>;
    const ids = (value: unknown) =>
      Array.isArray(value) ? value.filter((each): each is Id => typeof each === 'string') : [];
    return { lists: ids(saved.lists), tags: ids(saved.tags), filters: ids(saved.filters) };
  } catch {
    return NO_NARROWING;
  }
}

function save(view: NarrowView, next: Narrowing) {
  const raw = isNarrowed(next) ? JSON.stringify(next) : null;
  try {
    if (raw) localStorage.setItem(keyOf(view), raw);
    else localStorage.removeItem(keyOf(view));
  } catch {
    memory.set(keyOf(view), raw);
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

/**
 * A view's narrowing (spec: R-FB-53): the workspace with only the tasks it lets through, for the
 * view's queries, and the button that sets it.
 */
export function useNarrowed(view: NarrowView): {
  workspace: WorkspaceFile;
  narrowed: boolean;
  button: React.ReactNode;
} {
  const workspace = useWorkspace();
  const today = useToday();
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(view),
    () => null,
  );
  const narrowing = useMemo(() => parse(raw), [raw]);
  const narrowed = useMemo(
    () => narrowWorkspace(workspace, narrowing, today),
    [workspace, narrowing, today],
  );
  return {
    workspace: narrowed,
    narrowed: isNarrowed(narrowing),
    button: <NarrowButton narrowing={narrowing} onChange={(next) => save(view, next)} />,
  };
}
