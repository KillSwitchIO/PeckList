// Saved filters: a name plus a TaskFilter, shown in the sidebar as a view of their own (PL-015).

import { isLive, putEntity, requireEntity } from './collections.ts';
import type { TaskFilter } from './filters.ts';
import { cleanViewChoice, type ViewChoice } from './listView.ts';
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
 * kept there so it syncs without a schema change, and an older app just doesn't read it.
 */
export function filterOf(saved: SavedFilter): TaskFilter {
  return withoutView(saved.query) as TaskFilter;
}

/** How a saved filter's tasks are grouped and sorted, as someone last picked it on any device. */
export function viewOf(saved: SavedFilter): ViewChoice {
  return cleanViewChoice(saved.query.view);
}

function withoutView(query: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(query).filter(([key]) => key !== 'view'));
}

/** The query with this view choice, or with none when it is the defaults. */
function withView(query: Record<string, unknown>, view: ViewChoice): Record<string, unknown> {
  const rest = withoutView(query);
  return Object.keys(view).length === 0 ? rest : { ...rest, view };
}

/** Stores a saved filter's grouping and sort; the same choice again changes nothing. */
export function setSavedFilterView(
  ctx: OpContext,
  workspace: WorkspaceFile,
  id: Id,
  view: ViewChoice,
): WorkspaceFile {
  const saved = requireEntity(workspace, 'savedFilters', id);
  const next = cleanViewChoice(view);
  if (JSON.stringify(next) === JSON.stringify(viewOf(saved))) return workspace;
  return putEntity(
    workspace,
    'savedFilters',
    updateEntity(ctx, saved, { query: withView(saved.query, next) }),
  );
}

export function createSavedFilter(
  ctx: OpContext,
  workspace: WorkspaceFile,
  name: string,
  filter: TaskFilter,
): { workspace: WorkspaceFile; filter: SavedFilter } {
  const last = savedFiltersOf(workspace).at(-1);
  const saved = createEntity<SavedFilter>(ctx, {
    name: name.trim(),
    query: { ...filter },
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
): WorkspaceFile {
  const saved = requireEntity(workspace, 'savedFilters', id);
  return putEntity(
    workspace,
    'savedFilters',
    // Editing the conditions keeps the grouping and sort.
    updateEntity(ctx, saved, { name: name.trim(), query: withView({ ...filter }, viewOf(saved)) }),
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
