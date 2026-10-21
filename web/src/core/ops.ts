// Domain operations. Every write stamps the fields it touches with a fresh HLC, so any copy
// of the data can be merged with any other.

import type { IdGenerator } from '../ports/ids.ts';
import type { HlcClock } from './hlc.ts';
import type { BaseEntity, DateTime, ElementSet, Id } from './types.ts';

export interface OpContext {
  clock: HlcClock;
  ids: IdGenerator;
  userId: Id;
  origin: string;
  /** Wall clock for human-facing timestamps (createdAt, completedAt, deletedAt) */
  now: () => number;
}

export function isoNow(ctx: OpContext): DateTime {
  return new Date(ctx.now()).toISOString();
}

type Fields<T extends BaseEntity> = Omit<T, keyof BaseEntity>;
/** Fields a patch may change: everything except identity and provenance. */
export type Patch<T extends BaseEntity> = Partial<
  Omit<T, 'id' | '_hlc' | 'createdAt' | 'createdBy' | 'origin'>
>;

/** Create an entity, stamping every field with the same HLC. */
export function createEntity<T extends BaseEntity>(ctx: OpContext, fields: Fields<T>, id?: Id): T {
  const hlc = ctx.clock.tick();
  const entity = {
    id: id ?? ctx.ids.next(),
    createdAt: isoNow(ctx),
    createdBy: ctx.userId,
    deletedAt: null,
    origin: ctx.origin,
    ...fields,
  } as Record<string, unknown>;
  const clocks: Record<string, string> = {};
  for (const key of Object.keys(entity)) {
    if (key !== 'id') clocks[key] = hlc;
  }
  entity._hlc = clocks;
  return entity as unknown as T;
}

/** Apply a patch. Only fields whose value actually changes are stamped. */
export function updateEntity<T extends BaseEntity>(ctx: OpContext, entity: T, patch: Patch<T>): T {
  const current = entity as unknown as Record<string, unknown>;
  const changed = Object.entries(patch).filter(
    ([key, value]) => JSON.stringify(current[key]) !== JSON.stringify(value),
  );
  if (changed.length === 0) return entity;
  const hlc = ctx.clock.tick();
  const next: Record<string, unknown> = { ...current, _hlc: { ...entity._hlc } };
  const clocks = next._hlc as Record<string, string>;
  for (const [key, value] of changed) {
    next[key] = value;
    clocks[key] = hlc;
  }
  return next as unknown as T;
}

/**
 * Move an entity to the trash. Pass one `at` for every entity deleted by the same operation:
 * restore uses the shared timestamp to bring back exactly what was deleted together.
 */
export function softDelete<T extends BaseEntity>(
  ctx: OpContext,
  entity: T,
  at: DateTime = isoNow(ctx),
): T {
  if (entity.deletedAt !== null) return entity;
  const patch: Patch<BaseEntity> = { deletedAt: at };
  return updateEntity(ctx, entity, patch as Patch<T>);
}

export function restore<T extends BaseEntity>(ctx: OpContext, entity: T): T {
  if (entity.deletedAt === null) return entity;
  const patch: Patch<BaseEntity> = { deletedAt: null };
  return updateEntity(ctx, entity, patch as Patch<T>);
}

/** Add or remove one element of an element-set field. */
export function setElement(
  ctx: OpContext,
  set: ElementSet,
  element: string,
  present: boolean,
): ElementSet {
  if (set[element]?.in === present) return set;
  return { ...set, [element]: { in: present, hlc: ctx.clock.tick() } };
}

/** Elements currently in the set, sorted. */
export function members(set: ElementSet): string[] {
  return Object.entries(set)
    .filter(([, state]) => state.in)
    .map(([key]) => key)
    .sort();
}
