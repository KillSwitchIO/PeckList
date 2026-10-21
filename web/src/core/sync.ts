// Pure helpers for syncing with a server (spec: Data Model & Sync, Sync protocol). The engine that
// talks to the server lives in the app; everything here is plain data in, data out.

import { compareHlc } from './hlc.ts';
import { mergeEntity } from './merge.ts';
import {
  COLLECTIONS,
  ELEMENT_SET_FIELDS,
  type BaseEntity,
  type CollectionName,
  type Entities,
  type List,
  type WorkspaceFile,
} from './types.ts';

/** One entity on the wire. */
export interface SyncChange {
  collection: CollectionName;
  entity: BaseEntity;
}

/**
 * The newest clock the server has acknowledged for each entity id. An entity whose own newest
 * clock is beyond its ack holds something the server has not seen, and is pushed. Edits made
 * while a sync is in flight carry newer clocks, so they go out with the next one.
 */
export type Acks = Record<string, string>;

export function isCollection(name: string): name is CollectionName {
  return (COLLECTIONS as readonly string[]).includes(name);
}

/** The newest HLC in one entity: its field clocks and, for element sets, each element's clock. */
export function entityClock(entity: BaseEntity, collection: CollectionName): string | undefined {
  let newest: string | undefined;
  const consider = (value: string | undefined) => {
    if (compareHlc(value, newest) > 0) newest = value;
  };
  for (const value of Object.values(entity._hlc)) consider(value);
  const record = entity as unknown as Record<string, unknown>;
  for (const field of ELEMENT_SET_FIELDS[collection]) {
    const set = record[field] as Record<string, { hlc: string }> | undefined;
    for (const element of Object.values(set ?? {})) consider(element.hlc);
  }
  return newest;
}

/** Entities holding changes the server has not acknowledged, oldest collections first. */
export function pendingChanges(workspace: WorkspaceFile, acks: Acks): SyncChange[] {
  const pending: SyncChange[] = [];
  for (const collection of COLLECTIONS) {
    for (const entity of workspace.entities[collection]) {
      if (compareHlc(entityClock(entity, collection), acks[entity.id]) > 0) {
        pending.push({ collection, entity });
      }
    }
  }
  return pending;
}

/** Acks after the server has these versions (pushed and taken, or sent to us). */
export function acknowledge(acks: Acks, changes: readonly SyncChange[]): Acks {
  const next = { ...acks };
  for (const { collection, entity } of changes) {
    const clock = entityClock(entity, collection);
    if (clock !== undefined && compareHlc(clock, next[entity.id]) > 0) next[entity.id] = clock;
  }
  return next;
}

/**
 * Merge entities from the server into the workspace with the usual rules, and drop the ids the
 * user lost access to (removed outright: they are no longer the user's to keep). Unchanged
 * collections stay shared; with nothing to do the same workspace comes back.
 */
export function mergeRemote(
  workspace: WorkspaceFile,
  changes: readonly SyncChange[],
  revoked: readonly string[] = [],
): WorkspaceFile {
  if (changes.length === 0 && revoked.length === 0) return workspace;
  const gone = new Set(revoked);
  const byCollection = new Map<CollectionName, BaseEntity[]>();
  for (const change of changes) {
    if (!isCollection(change.collection)) continue;
    const list = byCollection.get(change.collection) ?? [];
    list.push(change.entity);
    byCollection.set(change.collection, list);
  }
  const entities = { ...workspace.entities } as Record<CollectionName, BaseEntity[]>;
  let changed = false;
  for (const collection of COLLECTIONS) {
    const incoming = byCollection.get(collection) ?? [];
    const current = entities[collection];
    if (incoming.length === 0 && !current.some((entity) => gone.has(entity.id))) continue;
    const byId = new Map(current.map((entity) => [entity.id, entity]));
    for (const entity of incoming) {
      const existing = byId.get(entity.id);
      byId.set(
        entity.id,
        existing ? mergeEntity(existing, entity, ELEMENT_SET_FIELDS[collection]) : entity,
      );
    }
    for (const id of gone) byId.delete(id);
    entities[collection] = [...byId.values()];
    changed = true;
  }
  return changed ? { ...workspace, entities: entities as unknown as Entities } : workspace;
}

/**
 * Undo changes the server refused: a refused entity becomes the server's copy (`corrections`,
 * taken as is, not merged, since the device's own newer clocks would win a merge), or leaves the
 * device when the server sent none (the user may not see it).
 */
export function applyRejections(
  workspace: WorkspaceFile,
  rejected: readonly string[],
  corrections: readonly SyncChange[],
): WorkspaceFile {
  if (rejected.length === 0) return workspace;
  const refused = new Set(rejected);
  const replacement = new Map(
    corrections
      .filter((change) => refused.has(change.entity.id))
      .map((change) => [change.entity.id, change]),
  );
  const entities = { ...workspace.entities } as Record<CollectionName, BaseEntity[]>;
  for (const collection of COLLECTIONS) {
    const current = entities[collection];
    if (!current.some((entity) => refused.has(entity.id))) continue;
    entities[collection] = current.flatMap((entity) => {
      if (!refused.has(entity.id)) return [entity];
      const correction = replacement.get(entity.id);
      return correction && correction.collection === collection ? [correction.entity] : [];
    });
  }
  // A correction for an entity the device did not have (it was made and refused here) stays out.
  return { ...workspace, entities: entities as unknown as Entities };
}

/**
 * The same workspace under another owner id: every field equal to the old id (createdBy,
 * completedBy, settings.userId, ...), `user:<id>` assignees, and the user's own profile entity.
 * Used once, when a device's local data joins a server account; the rewritten entities have
 * never been on the server, so no clocks need to move.
 */
export function rekeyOwner(workspace: WorkspaceFile, to: string): WorkspaceFile {
  const from = workspace.owner;
  if (from === to) return workspace;
  const swap = (value: unknown): unknown => {
    if (value === from) return to;
    if (value === `user:${from}`) return `user:${to}`;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      if (`user:${from}` in record) {
        const { [`user:${from}`]: element, ...rest } = record;
        return { ...rest, [`user:${to}`]: element };
      }
    }
    return value;
  };
  const entities = {} as Record<CollectionName, BaseEntity[]>;
  for (const collection of COLLECTIONS) {
    entities[collection] = workspace.entities[collection].map((entity) => {
      const record = entity as unknown as Record<string, unknown>;
      const next: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(record)) {
        next[field] = field === '_hlc' ? value : swap(value);
      }
      return next as unknown as BaseEntity;
    });
  }
  return { ...workspace, owner: to, entities: entities as unknown as Entities };
}

/**
 * A device's own workspace joining an account that already has data on the server: the device
 * keeps its tasks, but the account's Mess Drawer and settings win. Tasks and sections in the
 * device's Mess Drawer move to the account's; the device's duplicate Mess Drawer and settings are
 * dropped (they never reached the server). `server` is everything the account had.
 */
export function joinAccount(
  local: WorkspaceFile,
  accountId: string,
  server: readonly SyncChange[],
): WorkspaceFile {
  let workspace = rekeyOwner(local, accountId);
  const serverIds = new Set(server.map((change) => change.entity.id));
  const serverOf = <K extends CollectionName>(collection: K) =>
    server.filter((change) => change.collection === collection).map((change) => change.entity);

  const accountInbox = (serverOf('lists') as List[]).find(
    (list) => list.isInbox && list.deletedAt === null,
  );
  const localInboxes = workspace.entities.lists.filter(
    (list) => list.isInbox && !serverIds.has(list.id),
  );
  if (accountInbox && localInboxes.length > 0) {
    const moved = new Set(localInboxes.map((list) => list.id));
    workspace = {
      ...workspace,
      entities: {
        ...workspace.entities,
        lists: workspace.entities.lists.filter((list) => !moved.has(list.id)),
        sections: workspace.entities.sections.map((section) =>
          moved.has(section.listId) ? { ...section, listId: accountInbox.id } : section,
        ),
        tasks: workspace.entities.tasks.map((task) =>
          moved.has(task.listId) ? { ...task, listId: accountInbox.id } : task,
        ),
      },
    };
  }
  if (serverOf('settings').length > 0) {
    workspace = {
      ...workspace,
      entities: {
        ...workspace.entities,
        settings: workspace.entities.settings.filter((settings) => serverIds.has(settings.id)),
      },
    };
  }
  return mergeRemote(workspace, server);
}
