// Files on tasks (spec: PL-051). The workspace holds what each file is (name, size, type and the
// SHA-256 of its bytes); the bytes live in a BlobStore on each device and on the server under that
// hash. Whoever may change the task adds files; whoever added one, or the list's owner, removes it.
// The server enforces the same rules.

import { getEntity, isLive, putEntity, requireEntity } from './collections.ts';
import { createEntity, softDelete, updateEntity, type OpContext } from './ops.ts';
import { canEditTask, roleOn } from './sharing.ts';
import type { Attachment, Id, Task, WorkspaceFile } from './types.ts';

/** The longest file name kept (the schema's limit). */
export const MAX_ATTACHMENT_NAME = 255;

/** A task's live files, in the order they were added. */
export function attachmentsOf(workspace: WorkspaceFile, taskId: Id): Attachment[] {
  return workspace.entities.attachments
    .filter((attachment) => attachment.taskId === taskId && isLive(attachment))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export function canAttach(workspace: WorkspaceFile, me: Id, task: Task): boolean {
  return canEditTask(workspace, me, task);
}

/** Who added a file removes or renames it; a list's owner removes any. */
export function canChangeAttachment(
  workspace: WorkspaceFile,
  me: Id,
  attachment: Attachment,
): { rename: boolean; remove: boolean } {
  if (attachment.createdBy === me) return { rename: true, remove: true };
  const task = getEntity(workspace, 'tasks', attachment.taskId);
  return {
    rename: false,
    remove: task !== undefined && roleOn(workspace, me, task.listId) === 'owner',
  };
}

function cleanName(name: string): string {
  const trimmed = name.trim() || 'file';
  return trimmed.length > MAX_ATTACHMENT_NAME ? trimmed.slice(0, MAX_ATTACHMENT_NAME) : trimmed;
}

export function addAttachment(
  ctx: OpContext,
  workspace: WorkspaceFile,
  file: { taskId: Id; name: string; size: number; mime: string; sha256: string },
): { workspace: WorkspaceFile; attachment: Attachment } {
  requireEntity(workspace, 'tasks', file.taskId);
  if (!/^[0-9a-f]{64}$/.test(file.sha256)) throw new Error('not a SHA-256');
  const attachment = createEntity<Attachment>(ctx, {
    taskId: file.taskId,
    name: cleanName(file.name),
    size: Math.max(0, Math.floor(file.size)),
    mime: file.mime.slice(0, 255) || 'application/octet-stream',
    sha256: file.sha256,
  });
  return { workspace: putEntity(workspace, 'attachments', attachment), attachment };
}

export function renameAttachment(
  ctx: OpContext,
  workspace: WorkspaceFile,
  id: Id,
  name: string,
): WorkspaceFile {
  const attachment = requireEntity(workspace, 'attachments', id);
  return putEntity(
    workspace,
    'attachments',
    updateEntity(ctx, attachment, { name: cleanName(name) }),
  );
}

export function removeAttachment(ctx: OpContext, workspace: WorkspaceFile, id: Id): WorkspaceFile {
  const attachment = requireEntity(workspace, 'attachments', id);
  return putEntity(workspace, 'attachments', softDelete(ctx, attachment));
}

/** Pictures the app shows itself (the server serves the same types inline). */
export function isPicture(mime: string): boolean {
  return ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'].includes(mime);
}
