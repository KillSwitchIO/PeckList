// An in-memory stand-in for the server's /api/sync, with the same rules: merge what is pushed
// (another account's entities are refused), give each change a seq, hand back what is newer
// than the cursor. The C# server is tested against the same expectations.

import { mergeEntity } from '../core/merge.ts';
import { CURRENT_SCHEMA_VERSION } from '../core/migrations.ts';
import type { SyncChange } from '../core/sync.ts';
import { ELEMENT_SET_FIELDS, type BaseEntity } from '../core/types.ts';
import type { SyncRequest, SyncResponse } from '../ports/sync.ts';

interface Row {
  owner: string;
  seq: number;
  change: SyncChange;
}

export class FakeSyncServer {
  private seq = 0;
  readonly rows = new Map<string, Row>();
  pageSize = 500;
  calls = 0;
  /** Ids whose changes this server refuses (standing in for sharing rules). */
  readonly refuse = new Set<string>();
  /** Ids the next response says the account may no longer see (a list unshared). */
  revokeNext: string[] = [];

  sync(userId: string, request: SyncRequest): SyncResponse {
    this.calls += 1;
    if (request.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      throw new Error('schema_mismatch');
    }
    const rejected: string[] = [];
    for (const change of request.changes) {
      if (this.refuse.has(change.entity.id)) {
        rejected.push(change.entity.id);
        continue;
      }
      const row = this.rows.get(change.entity.id);
      // Another account's id, or one that names something else, is refused (SharingIndex.MayWrite;
      // this fake shares nothing). So is something new said to be made by someone else.
      const author = (change.entity as { createdBy?: unknown }).createdBy;
      if (
        (row && (row.owner !== userId || row.change.collection !== change.collection)) ||
        (!row && typeof author === 'string' && author !== userId)
      ) {
        rejected.push(change.entity.id);
        continue;
      }
      const entity: BaseEntity = row
        ? mergeEntity(row.change.entity, change.entity, ELEMENT_SET_FIELDS[change.collection])
        : structuredClone(change.entity);
      if (row && JSON.stringify(entity) === JSON.stringify(row.change.entity)) continue;
      this.seq += 1;
      this.rows.set(entity.id, {
        owner: row?.owner ?? userId,
        seq: this.seq,
        change: { collection: change.collection, entity },
      });
    }
    const newer = [...this.rows.values()]
      .filter((row) => row.owner === userId && row.seq > (request.cursor ?? 0))
      .sort((a, b) => a.seq - b.seq);
    const page = newer.slice(0, this.pageSize);
    return {
      cursor: page.at(-1)?.seq ?? request.cursor ?? 0,
      changes: page.map((row) => structuredClone(row.change)),
      more: newer.length > page.length,
      revoked: this.revokeNext.splice(0),
      rejected,
      corrections: rejected.flatMap((id) => {
        const row = this.rows.get(id);
        return row && row.owner === userId ? [structuredClone(row.change)] : [];
      }),
    };
  }

  /**
   * Start over (PL-147), as the server does it: tombstone what `userId` owns in these collections,
   * but their Inbox list. Returns how many went.
   */
  eraseOwnedBy(userId: string, collections: readonly string[]): number {
    let erased = 0;
    for (const row of this.rows.values()) {
      const { collection, entity } = row.change;
      if (row.owner !== userId || entity.deletedAt !== null || !collections.includes(collection)) {
        continue;
      }
      if (collection === 'lists' && (entity as { isInbox?: boolean }).isInbox) continue;
      this.seq += 1;
      row.seq = this.seq;
      row.change = {
        collection,
        entity: {
          ...entity,
          deletedAt: '2026-11-17T12:00:00.000Z',
          _hlc: { ...entity._hlc, deletedAt: '2099-01-01T00:00:00.000Z-0000-server' },
        },
      };
      erased += 1;
    }
    return erased;
  }

  entity(id: string): BaseEntity | undefined {
    return this.rows.get(id)?.change.entity;
  }
}
