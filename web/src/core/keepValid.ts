// A guard for data from elsewhere (a sync, an import): one entity this app cannot read must not
// stop the whole workspace from opening. Entities that break the schema keep the version this
// device had, or stay out when they are new; everything else goes through.

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
    const result = validate(current);
    if (result.valid) return { workspace: current, skipped };
    const blamed = new Map<string, Skipped>();
    for (const error of result.errors) {
      const match = AT.exec(error);
      if (!match) continue;
      const collection = match[1] as CollectionName;
      if (!COLLECTIONS.includes(collection)) continue;
      const entity = current.entities[collection][Number(match[2])] as BaseEntity | undefined;
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
