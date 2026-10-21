// Saved filters: a name plus a TaskFilter, shown in the sidebar as a view of their own (PL-015).

import { isLive, putEntity, requireEntity } from './collections.ts';
import type { TaskFilter } from './filters.ts';
import { createEntity, softDelete, updateEntity, type OpContext } from './ops.ts';
import { compareOrderKeys, keyBetween } from './ordering.ts';
import type { Id, SavedFilter, WorkspaceFile } from './types.ts';

/** The live saved filters in their order. */
export function savedFiltersOf(workspace: WorkspaceFile): SavedFilter[] {
  return workspace.entities.savedFilters
    .filter(isLive)
    .sort((a, b) => compareOrderKeys(a.order, b.order));
}

/** A saved filter's conditions. */
export function filterOf(saved: SavedFilter): TaskFilter {
  return saved.query as TaskFilter;
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
    updateEntity(ctx, saved, { name: name.trim(), query: { ...filter } }),
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

/** Which date choice a filter's fields match (anything else reads as "any"). */
export function dateChoiceOf(filter: TaskFilter): DateChoice {
  const key = JSON.stringify({ start: filter.start, dated: filter.dated });
  for (const [choice, fields] of Object.entries(DATE_CHOICES) as [DateChoice, TaskFilter][]) {
    if (JSON.stringify({ start: fields.start, dated: fields.dated }) === key) return choice;
  }
  return 'any';
}
