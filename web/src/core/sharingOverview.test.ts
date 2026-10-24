import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import { putEntity } from './collections.ts';
import { createGroup } from './groups.ts';
import { createList } from './lists.ts';
import { createEntity } from './ops.ts';
import { removeMember, setAssignee, shareList } from './sharing.ts';
import { sharingOverview } from './sharingOverview.ts';
import { createTask } from './tasks.ts';
import type { User, WorkspaceFile } from './types.ts';
import { createWorkspace } from './workspace.ts';

const BEN = '01JBBEN0000000000000000001';
const SAM = '01JBSAM0000000000000000002';
const JO = '01JBJ00000000000000000000J';

function world() {
  const ben = testContext('ben', undefined, BEN);
  let ws: WorkspaceFile = createWorkspace(ben);
  for (const [id, name] of [
    [SAM, 'Sam'],
    [JO, 'Jo'],
  ] as const) {
    ws = putEntity(
      ws,
      'users',
      createEntity<User>(ben, {
        handle: `${name.toLowerCase()}@test`,
        displayName: name,
        avatarColor: '#A7C7E7',
        homeServer: 'test',
      }),
    );
    // The profile keeps the id the tests name.
    const made = ws.entities.users.at(-1)!;
    ws = {
      ...ws,
      entities: { ...ws.entities, users: [...ws.entities.users.slice(0, -1), { ...made, id }] },
    };
  }
  const garden = createList(ben, ws, { name: 'Garden', color: '#CFE3A3' });
  const diary = createList(ben, garden.workspace, { name: 'Diary', color: '#A7C7E7' });
  return { ben, ws: diary.workspace, garden: garden.list, diary: diary.list };
}

describe('what I share', () => {
  it('lists shared lists and assignment-only tasks by person, then by group', () => {
    const { ben, ws: start, garden, diary } = world();
    let ws = shareList(ben, start, garden.id, `user:${SAM}`, 'editor');
    const crew = createGroup(ben, ws, { name: 'Crew', color: '#F2C6A0' });
    ws = shareList(ben, crew.workspace, garden.id, `group:${crew.group.id}`, 'viewer');
    // In a private list: Jo sees this task only because it is assigned to them.
    const secret = createTask(ben, ws, { title: 'Hide the gift', listId: diary.id });
    ws = setAssignee(ben, secret.workspace, secret.task.id, `user:${JO}`, true);
    // Sam is on Garden already: assigning there shares nothing more.
    const weed = createTask(ben, ws, { title: 'Weed', listId: garden.id });
    ws = setAssignee(ben, weed.workspace, weed.task.id, `user:${SAM}`, true);

    const overview = sharingOverview(ws, BEN);
    expect(
      overview.map((each) => [
        each.who.name,
        each.lists.map((shared) => [shared.list.name, shared.member.role]),
        each.tasks.map((task) => task.title),
      ]),
    ).toEqual([
      ['Jo', [], ['Hide the gift']],
      ['Sam', [['Garden', 'editor']], []],
      ['Crew', [['Garden', 'viewer']], []],
    ]);
  });

  it('forgets what is no longer shared', () => {
    const { ben, ws: start, garden } = world();
    const ws = shareList(ben, start, garden.id, `user:${SAM}`, 'editor');
    const member = sharingOverview(ws, BEN)[0]!.lists[0]!.member;
    expect(sharingOverview(removeMember(ben, ws, member.id), BEN)).toEqual([]);
  });

  it("leaves out other people's lists", () => {
    const { ws: start, garden } = world();
    const sam = testContext('sam', undefined, SAM);
    const ws = shareList(sam, start, garden.id, `user:${JO}`, 'editor');
    expect(sharingOverview(ws, SAM)).toEqual([]);
  });
});
