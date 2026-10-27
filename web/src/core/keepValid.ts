// A guard for data from elsewhere (a sync, an import): one entity this app cannot read must not
// stop the whole workspace from opening. Entities that break the schema keep the version this
// device had, or stay out when they are new; everything else goes through.

import { changedEntities } from './collections.ts';
import { COLLECTIONS, type BaseEntity, type CollectionName, type WorkspaceFile } from './types.ts';

interface Validation {
  valid: boolean;
  errors: string[];
}

/** One refused entity: which, and what the schema said about it. */
export interface Skipped {
  collection: CollectionName;
  id: string;
  errors: string[];
}

const AT = /^\/entities\/([A-Za-z]+)\/(\d+)(?:\/|\s|$)/;

/**
 * `after` as far as it is valid: entities that `validate` blames go back to their `before`
 * version (out, if new). When the errors point at no entity, `after` comes back as it is and the
 * caller's usual checks apply.
 *
 * `before` is taken as valid: only what changed since is checked (R-FB-94; the whole 9 MB of a
 * large workspace took 50 ms a sync answer). The schema has no rules across a collection, so the
 * changed entities on their own pass or fail just as they would among the rest.
 */
export function keepValid(
  before: WorkspaceFile,
  after: WorkspaceFile,
  validate: (document: unknown) => Validation,
): { workspace: WorkspaceFile; skipped: Skipped[] } {
  const skipped: Skipped[] = [];
  let current = after;
  // A restored entity can only fix things, so a few rounds settle it.
  for (let round = 0; round < 3; round += 1) {
    const changed = changedEntities(before, current);
    const checked = Object.fromEntries(
      COLLECTIONS.map((name) => [name, changed[name] ?? []]),
    ) as unknown as WorkspaceFile['entities'];
    const result = validate({ ...current, entities: checked });
    if (result.valid) return { workspace: current, skipped };
    const blamed = new Map<string, Skipped>();
    for (const error of result.errors) {
      const match = AT.exec(error);
      if (!match) continue;
      const collection = match[1] as CollectionName;
      if (!COLLECTIONS.includes(collection)) continue;
      const entity = (checked[collection] as BaseEntity[])[Number(match[2])];
      if (!entity) continue;
      const key = `${collection}:${entity.id}`;
      const entry = blamed.get(key) ?? { collection, id: entity.id, errors: [] };
      entry.errors.push(error);
      blamed.set(key, entry);
    }
    if (blamed.size === 0) break;
    const entities = { ...current.entities } as Record<CollectionName, BaseEntity[]>;
    for (const { collection, id } of blamed.values()) {
      const old = (before.entities[collection] as BaseEntity[]).find((each) => each.id === id);
      entities[collection] = entities[collection].flatMap((each) =>
        each.id !== id ? [each] : old ? [old] : [],
      );
    }
    current = { ...current, entities: entities as WorkspaceFile['entities'] };
    skipped.push(...blamed.values());
  }
  return { workspace: current, skipped };
}
