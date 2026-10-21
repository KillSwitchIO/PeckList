// Immutable helpers for reading and writing entities inside a workspace document.

import { compareHlc } from './hlc.ts';
import { COLLECTIONS, type CollectionName, type EntityMap, type WorkspaceFile } from './types.ts';

export function getEntity<K extends CollectionName>(
  workspace: WorkspaceFile,
  collection: K,
  id: string,
): EntityMap[K] | undefined {
  return (workspace.entities[collection] as EntityMap[K][]).find((entity) => entity.id === id);
}

export function requireEntity<K extends CollectionName>(
  workspace: WorkspaceFile,
  collection: K,
  id: string,
): EntityMap[K] {
  const entity = getEntity(workspace, collection, id);
  if (!entity) throw new Error(`${collection} ${id} not found`);
  return entity;
}

/** Insert or replace entities by id. Returns a new workspace; unchanged collections are shared. */
export function putEntities<K extends CollectionName>(
  workspace: WorkspaceFile,
  collection: K,
  entities: readonly EntityMap[K][],
): WorkspaceFile {
  if (entities.length === 0) return workspace;
  const incoming = new Map(entities.map((entity) => [entity.id, entity]));
  const current = workspace.entities[collection] as EntityMap[K][];
  const next = current.map((entity) => {
    const replacement = incoming.get(entity.id);
    if (replacement) incoming.delete(entity.id);
    return replacement ?? entity;
  });
  next.push(...incoming.values());
  return { ...workspace, entities: { ...workspace.entities, [collection]: next } };
}

export function putEntity<K extends CollectionName>(
  workspace: WorkspaceFile,
  collection: K,
  entity: EntityMap[K],
): WorkspaceFile {
  return putEntities(workspace, collection, [entity]);
}

export function isLive(entity: { deletedAt: string | null }): boolean {
  return entity.deletedAt === null;
}

/** The newest HLC anywhere in the document, so a clock can be advanced past it on load. */
export function maxHlc(workspace: WorkspaceFile): string | undefined {
  let max: string | undefined;
  const consider = (value: string | undefined) => {
    if (compareHlc(value, max) > 0) max = value;
  };
  for (const name of COLLECTIONS) {
    for (const entity of workspace.entities[name]) {
      for (const value of Object.values(entity._hlc)) consider(value);
      for (const field of Object.values(entity as unknown as Record<string, unknown>)) {
        if (field && typeof field === 'object' && !Array.isArray(field)) {
          for (const element of Object.values(field as Record<string, unknown>)) {
            if (element && typeof element === 'object' && 'hlc' in element) {
              consider((element as { hlc: string }).hlc);
            }
          }
        }
      }
    }
  }
  return max;
}
