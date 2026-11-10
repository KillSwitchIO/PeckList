// Undo as a new write. Restoring an old snapshot would lose to later merges, so undo instead
// re-applies the previous values of exactly the fields an operation changed, with fresh HLCs.

import { putEntities } from './collections.ts';
import { setElement, softDelete, updateEntity, type OpContext } from './ops.ts';
import {
  COLLECTIONS,
  ELEMENT_SET_FIELDS,
  type BaseEntity,
  type ElementSet,
  type WorkspaceFile,
} from './types.ts';

const IGNORED = new Set(['id', '_hlc']);

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Compute the write that reverts the change from `before` to `after`, applied on top of
 * `current` (which may contain later, unrelated changes).
 */
export function revertChange(
  ctx: OpContext,
  before: WorkspaceFile,
  after: WorkspaceFile,
  current: WorkspaceFile,
): WorkspaceFile {
  let next = current;
  // Back into the Trash (undoing a restore): at a fresh time, not the old one, the same for all
  // this write puts back that had one time, so a task and what came back with it still match.
  // Something held back on the server (a file it could not take) may still sit in the Trash at the
  // old time, and the server refuses a task at a time something on it already has (audit B5).
  const retrashed = new Map<string, string>();
  const freshFor = (was: string): string => {
    let at = retrashed.get(was);
    if (at === undefined) {
      at = new Date(ctx.now() + retrashed.size).toISOString();
      retrashed.set(was, at);
    }
    return at;
  };
  for (const name of COLLECTIONS) {
    const sets = new Set(ELEMENT_SET_FIELDS[name]);
    const previous = new Map<string, BaseEntity>(
      before.entities[name].map((entity) => [entity.id, entity]),
    );
    const now = new Map<string, BaseEntity>(
      current.entities[name].map((entity) => [entity.id, entity]),
    );
    const changed: BaseEntity[] = [];

    for (const entity of after.entities[name] as BaseEntity[]) {
      const old = previous.get(entity.id);
      if (old === entity) continue;
      const live = now.get(entity.id);
      if (!live) continue;
      if (!old) {
        // Created by the operation: undo moves it to the trash.
        changed.push(softDelete(ctx, live));
        continue;
      }
      const oldFields = old as unknown as Record<string, unknown>;
      const newFields = entity as unknown as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      let reverted = live as unknown as Record<string, unknown>;
      for (const field of new Set([...Object.keys(oldFields), ...Object.keys(newFields)])) {
        if (IGNORED.has(field) || same(oldFields[field], newFields[field])) continue;
        if (sets.has(field)) {
          let set = reverted[field] as ElementSet;
          const was = (oldFields[field] ?? {}) as ElementSet;
          const is = (newFields[field] ?? {}) as ElementSet;
          for (const element of new Set([...Object.keys(was), ...Object.keys(is)])) {
            const wasIn = was[element]?.in ?? false;
            if (wasIn !== (is[element]?.in ?? false)) set = setElement(ctx, set, element, wasIn);
          }
          reverted = { ...reverted, [field]: set };
        } else if (
          field === 'deletedAt' &&
          newFields[field] === null &&
          typeof oldFields[field] === 'string'
        ) {
          patch[field] = freshFor(oldFields[field]);
        } else {
          patch[field] = oldFields[field];
        }
      }
      changed.push(updateEntity(ctx, reverted as unknown as BaseEntity, patch));
    }
    next = putEntities(next, name, changed as never[]);
  }
  return next;
}
