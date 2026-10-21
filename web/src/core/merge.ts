// Conflict-free merge: per-field last-writer-wins by HLC, element sets merged per element.
// Must produce identical results to the server implementation; both are tested against
// schema/fixtures/merge.

import { compareHlc } from './hlc.ts';
import {
  COLLECTIONS,
  ELEMENT_SET_FIELDS,
  type BaseEntity,
  type CollectionName,
  type ElementSet,
  type Entities,
  type WorkspaceFile,
} from './types.ts';

const RESERVED = new Set(['id', '_hlc']);

/**
 * JSON with object keys sorted (by UTF-16 code units), so a value serializes the same whatever
 * order its keys arrived in. A database may reorder keys (PostgreSQL jsonb does).
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Deterministic tie-break when two writes carry the same HLC but different values: the larger
 * canonical JSON wins. The server compares the same way (schema/fixtures/merge/08).
 */
function tieBreak(a: unknown, b: unknown): unknown {
  return canonicalJson(a) >= canonicalJson(b) ? a : b;
}

export function mergeElementSets(a: ElementSet | undefined, b: ElementSet | undefined): ElementSet {
  const result: ElementSet = {};
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  for (const key of [...keys].sort()) {
    const left = a?.[key];
    const right = b?.[key];
    if (!left || !right) {
      const only = left ?? right;
      if (only) result[key] = { ...only };
    } else {
      const order = compareHlc(left.hlc, right.hlc);
      if (order > 0) result[key] = { ...left };
      else if (order < 0) result[key] = { ...right };
      // Same HLC: removal wins so the outcome does not depend on argument order.
      else result[key] = { in: left.in && right.in, hlc: left.hlc };
    }
  }
  return result;
}

export function mergeEntity<T extends BaseEntity>(
  a: T,
  b: T,
  setFields: readonly string[] = [],
): T {
  if (a.id !== b.id) {
    throw new Error(`cannot merge different entities: ${a.id} and ${b.id}`);
  }
  const sets = new Set(setFields);
  const left = a as unknown as Record<string, unknown>;
  const right = b as unknown as Record<string, unknown>;
  const result: Record<string, unknown> = { id: a.id };
  const clocks: Record<string, string> = {};

  const fields = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const field of [...fields].sort()) {
    if (RESERVED.has(field)) continue;
    const leftClock = a._hlc[field];
    const rightClock = b._hlc[field];
    const order = compareHlc(leftClock, rightClock);
    if (sets.has(field)) {
      result[field] = mergeElementSets(left[field] as ElementSet, right[field] as ElementSet);
      // The field-level clock only records when the set was created; elements carry their own.
      const clock = order >= 0 ? leftClock : rightClock;
      if (clock !== undefined) clocks[field] = clock;
      continue;
    }
    if (order > 0 || (order === 0 && !(field in right))) {
      result[field] = left[field];
    } else if (order < 0 || !(field in left)) {
      result[field] = right[field];
    } else {
      result[field] = tieBreak(left[field], right[field]);
    }
    const clock = order >= 0 ? leftClock : rightClock;
    if (clock !== undefined) clocks[field] = clock;
  }
  result._hlc = clocks;
  return result as unknown as T;
}

export function mergeCollection<T extends BaseEntity>(
  a: readonly T[],
  b: readonly T[],
  setFields: readonly string[] = [],
): T[] {
  const byId = new Map<string, T>();
  for (const entity of a) byId.set(entity.id, entity);
  for (const entity of b) {
    const existing = byId.get(entity.id);
    byId.set(entity.id, existing ? mergeEntity(existing, entity, setFields) : entity);
  }
  return [...byId.values()].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

export function mergeEntities(a: Entities, b: Entities): Entities {
  const result = {} as Record<CollectionName, BaseEntity[]>;
  for (const name of COLLECTIONS) {
    result[name] = mergeCollection<BaseEntity>(a[name], b[name], ELEMENT_SET_FIELDS[name]);
  }
  return result as unknown as Entities;
}

/** Merge two copies of the same user's workspace. Metadata comes from `local`. */
export function mergeWorkspaces(local: WorkspaceFile, remote: WorkspaceFile): WorkspaceFile {
  if (local.owner !== remote.owner) {
    throw new Error('cannot merge workspaces of different owners');
  }
  if (local.schemaVersion !== remote.schemaVersion) {
    throw new Error('cannot merge workspaces with different schema versions');
  }
  return { ...local, entities: mergeEntities(local.entities, remote.entities) };
}
