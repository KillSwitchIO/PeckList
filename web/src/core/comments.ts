// Comments on tasks (spec: PL-050). A comment is seen by whoever sees its task; writing one needs
// the right to change the task; only its author changes it, and a list's owner may delete it. The
// server enforces the same rules.

import { getEntity, isLive, putEntity, requireEntity } from './collections.ts';
import { mentionedNames } from './commentText.ts';
import { createEntity, isoNow, softDelete, updateEntity, type OpContext } from './ops.ts';
import { canEditTask, listOwner, roleOn } from './sharing.ts';
import type { Comment, Group, Id, Task, User, WorkspaceFile } from './types.ts';

export const MAX_COMMENT_LENGTH = 20000;

/** A task's live comments, oldest first. */
export function commentsOf(workspace: WorkspaceFile, taskId: Id): Comment[] {
  return workspace.entities.comments
    .filter((comment) => comment.taskId === taskId && isLive(comment))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export function canComment(workspace: WorkspaceFile, me: Id, task: Task): boolean {
  return canEditTask(workspace, me, task);
}

/** Its author edits a comment; its author or the list's owner deletes it. */
export function canChangeComment(
  workspace: WorkspaceFile,
  me: Id,
  comment: Comment,
): { edit: boolean; delete: boolean } {
  if (comment.createdBy === me) return { edit: true, delete: true };
  const task = getEntity(workspace, 'tasks', comment.taskId);
  return {
    edit: false,
    delete: task !== undefined && roleOn(workspace, me, task.listId) === 'owner',
  };
}

function cleanBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) throw new Error('a comment needs some text');
  return trimmed.length > MAX_COMMENT_LENGTH ? trimmed.slice(0, MAX_COMMENT_LENGTH) : trimmed;
}

export function addComment(
  ctx: OpContext,
  workspace: WorkspaceFile,
  taskId: Id,
  body: string,
): { workspace: WorkspaceFile; comment: Comment } {
  requireEntity(workspace, 'tasks', taskId);
  const comment = createEntity<Comment>(ctx, { taskId, body: cleanBody(body), editedAt: null });
  return { workspace: putEntity(workspace, 'comments', comment), comment };
}

export function editComment(
  ctx: OpContext,
  workspace: WorkspaceFile,
  id: Id,
  body: string,
): WorkspaceFile {
  const comment = requireEntity(workspace, 'comments', id);
  const next = cleanBody(body);
  if (next === comment.body) return workspace;
  return putEntity(
    workspace,
    'comments',
    updateEntity(ctx, comment, { body: next, editedAt: isoNow(ctx) }),
  );
}

export function deleteComment(ctx: OpContext, workspace: WorkspaceFile, id: Id): WorkspaceFile {
  return putEntity(
    workspace,
    'comments',
    softDelete(ctx, requireEntity(workspace, 'comments', id)),
  );
}

/** The name an @mention uses: the part of the handle before the server (`sam@tasks.example.com`). */
export function mentionName(user: User): string {
  return user.handle.split('@')[0] || user.displayName;
}

/**
 * People who can see the task, to @mention: its list's owner and members (groups as their active
 * members) and its assignees, by name, without me.
 */
export function mentionCandidates(workspace: WorkspaceFile, me: Id, task: Task): User[] {
  const ids = new Set<Id>();
  const addPrincipal = (principal: string) => {
    const [kind, id] = principal.split(':');
    if (!id) return;
    if (kind === 'user') ids.add(id);
    if (kind === 'group') {
      for (const member of workspace.entities.groupMembers) {
        if (member.groupId === id && member.state === 'active' && isLive(member))
          ids.add(member.userId);
      }
    }
  };
  const list = getEntity(workspace, 'lists', task.listId);
  if (list) ids.add(listOwner(list));
  for (const member of workspace.entities.listMembers) {
    if (member.listId === task.listId && isLive(member)) addPrincipal(member.principal);
  }
  for (const [principal, element] of Object.entries(task.assignees)) {
    if (element.in) addPrincipal(principal);
  }
  ids.delete(me);
  return [...ids]
    .map((id) => getEntity(workspace, 'users', id))
    .filter((user): user is User => user !== undefined && isLive(user))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/**
 * Groups to @mention at once: each live group with members among `people` (those who can see the
 * task, without me), and those members. Choosing one writes an @name for each of them: the server
 * notifies people by name only, and never someone who cannot see the task, so no one else is
 * named (Ben, 2026-11-12).
 */
export function mentionGroups(
  workspace: WorkspaceFile,
  people: readonly User[],
): { group: Group; members: User[] }[] {
  return workspace.entities.groups
    .filter((group) => isLive(group) && !group.archived)
    .map((group) => {
      const ids = new Set(
        workspace.entities.groupMembers
          .filter((member) => member.groupId === group.id && member.state === 'active')
          .filter(isLive)
          .map((member) => member.userId),
      );
      return { group, members: people.filter((person) => ids.has(person.id)) };
    })
    .filter(({ members }) => members.length > 0)
    .sort((a, b) => a.group.name.localeCompare(b.group.name));
}

/** Letters put at the caret to ask the comment reader whether a name typed there would count. */
const PROBE = 'Zq9';

/**
 * The @name being typed at `caret`, or null: only where the comment, once sent, would count it as a
 * mention, so the picker never offers a name the server would not notify (audit D3). That is after
 * an @ at the start, a space or an opening bracket, then a letter or digit (or nothing yet), and
 * not in `code` or a link's label. Asked of the comment reader itself, with a probe name at the
 * caret, so the picker and the reader cannot drift apart.
 */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /@([\p{L}\p{N}._-]*)$/u.exec(before);
  if (!match) return null;
  const query = match[1]!;
  const probed = mentionedNames(`${before}${PROBE}${text.slice(caret)}`);
  if (!probed.some((name) => name.startsWith(query + PROBE))) return null;
  return { start: caret - query.length - 1, query };
}
