// "What you share" (spec: PL-087): everything I share, by person and by group, read from the local
// workspace: lists I own and share, and tasks shared only by assignment (assigned to someone who is
// not on the task's list).

import { isLive } from './collections.ts';
import {
  assigneesOf,
  describePrincipal,
  listMembersOf,
  listOwner,
  type Assignee,
} from './sharing.ts';
import type { Id, List, ListMember, Task, WorkspaceFile } from './types.ts';

export interface SharedWith {
  /** `user:<id>` or `group:<id>` */
  principal: string;
  who: Assignee;
  /** Lists shared with them, with the membership that does it (for its role and to stop it). */
  lists: { list: List; member: ListMember }[];
  /** Tasks they see only because they are assigned. */
  tasks: Task[];
}

const byName =
  <T>(name: (each: T) => string) =>
  (a: T, b: T) =>
    name(a).localeCompare(name(b));

/** People first, then groups, each by name; inside, lists and tasks by name. */
export function sharingOverview(workspace: WorkspaceFile, me: Id): SharedWith[] {
  const self = `user:${me}`;
  // The Mess Drawer is always mine (it is never shared, but its tasks can be assigned).
  const mine = workspace.entities.lists.filter(
    (list) => isLive(list) && (list.isInbox || listOwner(list) === me),
  );
  const mineById = new Map(mine.map((list) => [list.id, list]));
  const found = new Map<string, SharedWith>();
  const entry = (principal: string) => {
    let shared = found.get(principal);
    if (!shared) {
      shared = { principal, who: describePrincipal(workspace, principal), lists: [], tasks: [] };
      found.set(principal, shared);
    }
    return shared;
  };

  const onList = new Map<Id, Set<string>>();
  for (const list of mine) {
    const members = listMembersOf(workspace, list.id).filter((member) => member.principal !== self);
    onList.set(list.id, new Set(members.map((member) => member.principal)));
    if (list.visibility !== 'shared') continue;
    for (const member of members) entry(member.principal).lists.push({ list, member });
  }

  for (const task of workspace.entities.tasks) {
    if (!isLive(task) || task.status !== 'open' || !mineById.has(task.listId)) continue;
    for (const principal of assigneesOf(task)) {
      if (principal === self || !/^(user|group):/.test(principal)) continue;
      if (onList.get(task.listId)?.has(principal)) continue;
      entry(principal).tasks.push(task);
    }
  }

  const all = [...found.values()];
  for (const shared of all) {
    shared.lists.sort(byName((each) => each.list.name));
    shared.tasks.sort(byName((each) => each.title));
  }
  const people = all.filter((each) => each.principal.startsWith('user:'));
  const groups = all.filter((each) => each.principal.startsWith('group:'));
  return [
    ...people.sort(byName((each) => each.who.name)),
    ...groups.sort(byName((each) => each.who.name)),
  ];
}
