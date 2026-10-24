// Deterministic test helpers: a fixed clock, counting id generator and sample data.
import { HlcClock } from '../core/hlc.ts';
import { keyBetween } from '../core/ordering.ts';
import { createEntity, setElement, type OpContext } from '../core/ops.ts';
import type { Tag, Task, WorkspaceFile } from '../core/types.ts';
import { createWorkspace } from '../core/workspace.ts';
import type { IdGenerator } from '../ports/ids.ts';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Valid, sortable, deterministic ULID-shaped ids: 01TEST0000...0001, ...0002 */
export function countingIds(prefix = '01TEST'): IdGenerator {
  let n = 0;
  return {
    next() {
      n += 1;
      let suffix = '';
      let value = n;
      for (let i = 0; i < 26 - prefix.length; i += 1) {
        suffix = CROCKFORD.charAt(value % 32) + suffix;
        value = Math.floor(value / 32);
      }
      return prefix + suffix;
    },
  };
}

export const T0 = Date.UTC(2026, 9, 20, 16, 15, 0, 0);

export function testContext(
  node = 'dev1',
  start = T0,
  userId = '01TESTMEMBER00000000000001',
): OpContext {
  let time = start;
  const now = () => time;
  return {
    clock: new HlcClock({ node, now: () => (time += 1) }),
    ids: countingIds(
      `01${node
        .toUpperCase()
        .replace(/[^0-9A-HJKMNP-TV-Z]/g, 'X')
        .slice(0, 4)
        .padEnd(4, 'X')}`,
    ),
    userId,
    origin: 'local',
    now,
  };
}

export function sampleTask(
  ctx: OpContext,
  listId: string,
  title: string,
  order = keyBetween(null, null),
): Task {
  return createEntity<Task>(ctx, {
    title,
    notes: '',
    listId,
    sectionId: null,
    parentId: null,
    order,
    status: 'open',
    completedAt: null,
    completedBy: null,
    priority: 0,
    schedule: null,
    due: null,
    tags: {},
    assignees: {},
    blockedBy: {},
    recurrence: null,
    progress: 0,
  });
}

export function sampleWorkspace(ctx: OpContext = testContext()): WorkspaceFile {
  const workspace = createWorkspace(ctx);
  const inbox = workspace.entities.lists[0]!;
  const tag = createEntity<Tag>(ctx, { name: 'home/yard', color: '#CFE3A3', order: 'V' });
  const first = sampleTask(ctx, inbox.id, 'Mow lawn', 'V');
  const second = sampleTask(ctx, inbox.id, 'Call vet', keyBetween('V', null));
  second.tags = setElement(ctx, second.tags, tag.id, true);
  second.schedule = {
    start: '2026-10-21T09:00',
    end: null,
    allDay: false,
    timeZone: 'America/Chicago',
  };
  second.due = { at: '2026-10-22', allDay: true, timeZone: 'America/Chicago' };
  workspace.entities.tags.push(tag);
  workspace.entities.tasks.push(first, second);
  return workspace;
}
