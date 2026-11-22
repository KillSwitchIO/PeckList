// Saved filters: a name plus a TaskFilter, shown in the sidebar as a view of their own (PL-015).

import { isLive, putEntity, requireEntity } from './collections.ts';
import type { TaskFilter } from './filters.ts';
import { cleanViewChoice, VIEW_CHOICE_KEYS, type ViewChoice } from './listView.ts';
import { createEntity, softDelete, updateEntity, type OpContext } from './ops.ts';
import { compareOrderKeys, keyBetween } from './ordering.ts';
import type { Id, SavedFilter, WorkspaceFile } from './types.ts';

/** The live saved filters in their order. */
export function savedFiltersOf(workspace: WorkspaceFile): SavedFilter[] {
  return workspace.entities.savedFilters
    .filter(isLive)
    .sort((a, b) => compareOrderKeys(a.order, b.order));
}

/**
 * A saved filter's conditions. `query` also holds `view`, the filter's grouping and sort (PL-015):
 * kept there so it syncs without a schema change, and an older app just doesn't read it. Fields of
 * `view` this version doesn't know (a later version's, such as a layout) are carried through every
 * edit here, so an older device never strips them.
 */
export function filterOf(saved: SavedFilter): TaskFilter {
  return withoutView(saved.query) as TaskFilter;
}

/** How a saved filter's tasks are grouped and sorted, as someone last picked it on any device. */
export function viewOf(saved: SavedFilter): ViewChoice {
  return cleanViewChoice(saved.query.view);
}

/**
 * How a saved filter shows in the sidebar and bottom bar (PL-149): a color and an icon, as a list
 * has, or none for the plain filter icon. Kept in the stored view beside the grouping and sort, so
 * it syncs without a schema change. 0.15 and later carry view fields they don't know through their
 * edits; 0.14 rewrites the query on an edit and drops the whole view, look included.
 */
export interface FilterLook {
  color: string | null;
  icon: string | null;
}

export function lookOf(saved: SavedFilter): FilterLook {
  const view = storedView(saved) ?? {};
  const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null);
  return { color: text(view.color), icon: text(view.icon) };
}

/** `view` with this look in place of the one it had (none given: as it was). */
function withLook(
  view: Record<string, unknown> | null,
  look: FilterLook | undefined,
): Record<string, unknown> | null {
  if (!look) return view;
  const rest = Object.fromEntries(
    Object.entries(view ?? {}).filter(([key]) => key !== 'color' && key !== 'icon'),
  );
  return {
    ...rest,
    ...(look.color ? { color: look.color } : {}),
    ...(look.icon ? { icon: look.icon } : {}),
  };
}

function withoutView(query: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(query).filter(([key]) => key !== 'view'));
}

/** The stored view as it is, when it is an object at all. */
function storedView(saved: SavedFilter): Record<string, unknown> | null {
  const view = saved.query.view;
  return typeof view === 'object' && view !== null && !Array.isArray(view)
    ? (view as Record<string, unknown>)
    : null;
}

/** The stored view's fields this version doesn't know: a later version's, kept as they are. */
function laterViewFields(saved: SavedFilter): Record<string, unknown> {
  const known: readonly string[] = VIEW_CHOICE_KEYS;
  return Object.fromEntries(
    Object.entries(storedView(saved) ?? {}).filter(([key]) => !known.includes(key)),
  );
}

/**
 * The stored view's known fields with a value this version can't read (a later version's grouping,
 * say), which `next` leaves alone: picking only a sort keeps a grouping it can't show.
 */
function unreadViewFields(saved: SavedFilter, next: ViewChoice): Record<string, unknown> {
  const stored = storedView(saved) ?? {};
  const readable = cleanViewChoice(stored) as Record<string, unknown>;
  return Object.fromEntries(
    VIEW_CHOICE_KEYS.filter((key) => key in stored && !(key in readable) && !(key in next)).map(
      (key) => [key, stored[key]],
    ),
  );
}

/** Two views with the same fields and values, in any key order. */
function sameView(a: Record<string, unknown> | null, b: Record<string, unknown> | null): boolean {
  const text = (view: Record<string, unknown> | null) =>
    JSON.stringify(Object.entries(view ?? {}).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
  return text(a) === text(b);
}

/** The query with this view, or with none when it is empty (the defaults, nothing later). */
function withView(
  query: Record<string, unknown>,
  view: Record<string, unknown> | null,
): Record<string, unknown> {
  const rest = withoutView(query);
  return view === null || Object.keys(view).length === 0 ? rest : { ...rest, view };
}

/**
 * Stores a saved filter's grouping and sort; the same choice again changes nothing. The view's
 * fields this version doesn't know stay as they were, and so does a grouping or sort it can't read
 * that the choice doesn't set. Restore defaults (`{}`) clears every known field.
 */
export function setSavedFilterView(
  ctx: OpContext,
  workspace: WorkspaceFile,
  id: Id,
  view: ViewChoice,
): WorkspaceFile {
  const saved = requireEntity(workspace, 'savedFilters', id);
  const next = cleanViewChoice(view);
  const kept = Object.keys(next).length === 0 ? {} : unreadViewFields(saved, next);
  const written = { ...laterViewFields(saved), ...kept, ...next };
  if (sameView(written, storedView(saved))) return workspace;
  return putEntity(
    workspace,
    'savedFilters',
    updateEntity(ctx, saved, { query: withView(saved.query, written) }),
  );
}

export function createSavedFilter(
  ctx: OpContext,
  workspace: WorkspaceFile,
  name: string,
  filter: TaskFilter,
  look?: FilterLook,
): { workspace: WorkspaceFile; filter: SavedFilter } {
  const last = savedFiltersOf(workspace).at(-1);
  const saved = createEntity<SavedFilter>(ctx, {
    name: name.trim(),
    query: withView({ ...filter }, withLook(null, look)),
    order: keyBetween(last?.order ?? null, null),
  });
  return { workspace: putEntity(workspace, 'savedFilters', saved), filter: saved };
}

export function updateSavedFilter(
  ctx: OpContext,
  workspace: WorkspaceFile,
  id: Id,
  name: string,
  filter: TaskFilter,
  look?: FilterLook,
): WorkspaceFile {
  const saved = requireEntity(workspace, 'savedFilters', id);
  return putEntity(
    workspace,
    'savedFilters',
    // Editing the name, conditions or look keeps the rest of the view exactly as stored, a later
    // version's fields too.
    updateEntity(ctx, saved, {
      name: name.trim(),
      query: withView({ ...filter }, withLook(storedView(saved), look)),
    }),
  );
}

export function deleteSavedFilter(ctx: OpContext, workspace: WorkspaceFile, id: Id): WorkspaceFile {
  const saved = requireEntity(workspace, 'savedFilters', id);
  return putEntity(workspace, 'savedFilters', softDelete(ctx, saved));
}

/** The start-date choices a filter offers, as TaskFilter fields. */
export const DATE_CHOICES = {
  any: {},
  overdue: { start: { to: -1 } },
  today: { start: { to: 0 } },
  week: { start: { to: 7 } },
  later: { start: { from: 8 } },
  undated: { dated: false },
} as const satisfies Record<string, TaskFilter>;

export type DateChoice = keyof typeof DATE_CHOICES;

/** The due-date choices a filter offers, as TaskFilter fields. */
export const DUE_CHOICES = {
  any: {},
  overdue: { due: { to: -1 } },
  today: { due: { to: 0 } },
  week: { due: { to: 7 } },
  later: { due: { from: 8 } },
  none: { hasDue: false },
} as const satisfies Record<string, TaskFilter>;

export type DueChoice = keyof typeof DUE_CHOICES;

/** Which due choice a filter's fields match (anything else reads as "any"). */
export function dueChoiceOf(filter: TaskFilter): DueChoice {
  const key = JSON.stringify({ due: filter.due, hasDue: filter.hasDue });
  for (const [choice, fields] of Object.entries(DUE_CHOICES) as [DueChoice, TaskFilter][]) {
    if (JSON.stringify({ due: fields.due, hasDue: fields.hasDue }) === key) return choice;
  }
  return 'any';
}

/** Which date choice a filter's fields match (anything else reads as "any"). */
export function dateChoiceOf(filter: TaskFilter): DateChoice {
  const key = JSON.stringify({ start: filter.start, dated: filter.dated });
  for (const [choice, fields] of Object.entries(DATE_CHOICES) as [DateChoice, TaskFilter][]) {
    if (JSON.stringify({ start: fields.start, dated: fields.dated }) === key) return choice;
  }
  return 'any';
}
