// Opening a workspace document from any source: version check, migration, validation.

import type { SchemaValidator } from '../ports/validator.ts';
import { capStoredBottomBar } from './bottomBar.ts';
import { capStoredNotes } from './tasks.ts';
import { messageOf } from './errors.ts';
import {
  checkVersion,
  migrate,
  type MigrationRegistry,
  MIGRATIONS,
  CURRENT_SCHEMA_VERSION,
} from './migrations.ts';
import { sha256Hex } from './sha256.ts';
import { joinAccount, rekeyOwner, type SyncChange } from './sync.ts';
import { isPurged } from './trash.ts';
import { COLLECTIONS, type BaseEntity, type CollectionName, type WorkspaceFile } from './types.ts';

export type OpenResult =
  | { kind: 'ok'; workspace: WorkspaceFile }
  /** The document is older: the caller must ask for consent, back it up, then call upgrade. */
  | { kind: 'needs-upgrade'; from: number; to: number; document: Record<string, unknown> }
  /** The document is newer than this app: refuse and offer an app update. */
  | { kind: 'needs-app-update'; fileVersion: number; supported: number }
  | { kind: 'invalid'; errors: string[] };

export function parseJson(
  text: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

export function openDocument(
  document: unknown,
  validator: SchemaValidator,
  supported = CURRENT_SCHEMA_VERSION,
): OpenResult {
  const check = checkVersion(document, supported);
  switch (check.kind) {
    case 'invalid':
      return { kind: 'invalid', errors: [check.reason] };
    case 'refuse':
      return {
        kind: 'needs-app-update',
        fileVersion: check.fileVersion,
        supported: check.supported,
      };
    case 'upgrade':
      return {
        kind: 'needs-upgrade',
        from: check.from,
        to: check.to,
        document: document as Record<string, unknown>,
      };
    case 'open': {
      const repaired = capStoredNotes(capStoredBottomBar(document));
      const result = validator.validate(repaired);
      return result.valid
        ? { kind: 'ok', workspace: repaired as WorkspaceFile }
        : { kind: 'invalid', errors: result.errors };
    }
  }
}

/** Run migrations on an older document, then validate the result. */
export function upgradeDocument(
  document: Record<string, unknown>,
  validator: SchemaValidator,
  target = CURRENT_SCHEMA_VERSION,
  registry: MigrationRegistry = MIGRATIONS,
): OpenResult {
  let upgraded: Record<string, unknown>;
  try {
    upgraded = migrate(document, target, registry);
  } catch (error) {
    return { kind: 'invalid', errors: [messageOf(error)] };
  }
  return openDocument(upgraded, validator, target);
}

/**
 * An exported file brought into this device's data. Same-id entities merge field by field (the
 * newer edit wins, so nothing here is overwritten by an older copy). A file from another person or
 * device becomes this owner's: its own Mess Drawer, settings and profile give way to this one's,
 * and the Mess Drawer's tasks move into this one's.
 */
export function importWorkspace(
  current: WorkspaceFile,
  incoming: WorkspaceFile,
  options: { onServer?: boolean } = {},
): WorkspaceFile {
  const here: SyncChange[] = COLLECTIONS.flatMap((collection) =>
    current.entities[collection].map((entity) => ({ collection, entity })),
  );
  const file = options.onServer ? adoptAnotherAccount(current, incoming) : incoming;
  const joined = joinAccount(file, current.owner, here);
  return { ...current, entities: joined.entities };
}

/** What another account's file brings: the things in it, not its people or its sharing. */
const ADOPTED: readonly CollectionName[] = [
  'folders',
  'lists',
  'sections',
  'tags',
  'tasks',
  'savedFilters',
  'comments',
  'attachments',
  'templates',
];

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A ULID for `id` in `owner`'s account: the same time part, and 80 bits of a hash of both. The
 * same file imported again into the same account gives the same ids, so it merges instead of
 * making a second copy; another account gets other ids.
 */
export function adoptedId(id: string, owner: string): string {
  const hex = sha256Hex(new TextEncoder().encode(`${owner}:${id}`)).slice(0, 20);
  let bits = BigInt(`0x${hex}`);
  let tail = '';
  for (let at = 0; at < 16; at += 1) {
    tail = CROCKFORD[Number(bits & 31n)]! + tail;
    bits >>= 5n;
  }
  return id.slice(0, 10) + tail;
}

/**
 * Another account's export brought into this one on a server (1.0). The server keeps each id with
 * the account that made it and refuses it from anyone else, so the file's own ids would all be
 * undone. Everything this account doesn't already hold gets a fresh id (`adoptedId`), with every
 * reference to it changed to match (a subtask's parent, a task's list and tags, a template's tags,
 * set keys). What it already holds (a list shared with it) is left as the server has it.
 *
 * It comes in as this account's own, as the server requires of anything new: made by it, in lists
 * it owns, assigned to it at most. People and sharing (profiles, friends, groups, members) and the
 * file's settings stay out, as do comments and files someone else added, and what was purged (an
 * emptied Trash's markers bring nothing); a link to one of those is dropped too, so a subtask
 * whose parent was purged comes in at the top of its list (Dev 2). Trashed records
 * come in trashed, restorable. Other people's ids in fields such as `completedBy` stay as they
 * are: they name who did it, and the server takes them. A file from this same account (another
 * device, another server) keeps its ids, as before.
 */
export function adoptAnotherAccount(
  current: WorkspaceFile,
  incoming: WorkspaceFile,
): WorkspaceFile {
  const me = current.owner;
  if (incoming.owner === me) return incoming;
  const file = rekeyOwner(incoming, me);
  const held = new Set(
    COLLECTIONS.flatMap((collection) => current.entities[collection].map((entity) => entity.id)),
  );
  const wanted = (collection: CollectionName, entity: BaseEntity): boolean => {
    if (held.has(entity.id) || isPurged(entity)) return false;
    if (collection !== 'comments' && collection !== 'attachments') return true;
    // Someone else's words or files: not this account's to add as its own.
    const record = entity as unknown as { createdBy?: string; taskId?: string };
    return record.createdBy === me && !held.has(record.taskId ?? '');
  };
  const renamed = new Map<string, string>();
  // Left out (purged, or someone else's words): a set entry naming one goes too.
  const dropped = new Set<string>();
  for (const collection of ADOPTED) {
    for (const entity of file.entities[collection]) {
      if (wanted(collection, entity)) renamed.set(entity.id, adoptedId(entity.id, me));
      else if (!held.has(entity.id)) dropped.add(entity.id);
    }
  }
  // An id as a value or a key, alone or after a kind ("user:", "group:").
  const swap = (text: string): string => {
    const whole = renamed.get(text);
    if (whole) return whole;
    const colon = text.indexOf(':');
    const after = colon > 0 ? renamed.get(text.slice(colon + 1)) : undefined;
    return after ? text.slice(0, colon + 1) + after : text;
  };
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') return swap(value);
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([key]) => !dropped.has(key))
          .map(([key, each]) => [swap(key), walk(each)]),
      );
    }
    return value;
  };
  const adopt = (collection: CollectionName, entity: BaseEntity): BaseEntity => {
    const { _hlc, ...fields } = entity as unknown as Record<string, unknown>;
    const next = walk(fields) as Record<string, unknown>;
    // A parent or section left out would be named by nothing: no parent, no section instead.
    for (const field of ['parentId', 'sectionId']) {
      const linked = fields[field];
      if (typeof linked === 'string' && dropped.has(linked)) next[field] = null;
    }
    next._hlc = _hlc;
    next.createdBy = me;
    if ('ownerId' in next) next.ownerId = me;
    if (collection === 'lists') next.visibility = 'private';
    if (collection === 'tasks') {
      const assignees = (next.assignees ?? {}) as Record<string, unknown>;
      next.assignees = Object.fromEntries(
        Object.entries(assignees).filter(([key]) => key === `user:${me}`),
      );
    }
    return next as unknown as BaseEntity;
  };
  const entities = {} as Record<CollectionName, BaseEntity[]>;
  for (const collection of COLLECTIONS) {
    entities[collection] = ADOPTED.includes(collection)
      ? file.entities[collection]
          .filter((entity) => wanted(collection, entity))
          .map((entity) => adopt(collection, entity))
      : [];
  }
  return { ...file, entities: entities as unknown as WorkspaceFile['entities'] };
}

/** How many live entities of each kind `after` has that `before` did not. */
export function importCounts(
  before: WorkspaceFile,
  after: WorkspaceFile,
): { tasks: number; lists: number; tags: number; templates: number } {
  const added = (collection: 'tasks' | 'lists' | 'tags' | 'templates') => {
    const known = new Set(before.entities[collection].map((entity) => entity.id));
    return after.entities[collection].filter(
      (entity) => !known.has(entity.id) && entity.deletedAt === null,
    ).length;
  };
  return {
    tasks: added('tasks'),
    lists: added('lists'),
    tags: added('tags'),
    templates: added('templates'),
  };
}
