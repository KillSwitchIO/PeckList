// A person's profile picture (spec: R-FB-57): a small square image kept on their profile entity,
// so friends and group members see it too. Empty: their initials on their color.

import { getEntity, putEntity } from './collections.ts';
import { updateEntity, type OpContext } from './ops.ts';
import type { WorkspaceFile } from './types.ts';

/** The most a photo may take up as text (the schema's limit). */
export const PHOTO_MAX_LENGTH = 80_000;
const PHOTO = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;

export const isPhoto = (value: string) => value.length <= PHOTO_MAX_LENGTH && PHOTO.test(value);

/** Set (or with "", take away) the signed-in person's photo. Others' profiles are theirs. */
export function setProfilePhoto(
  ctx: OpContext,
  workspace: WorkspaceFile,
  photo: string,
): WorkspaceFile {
  const me = getEntity(workspace, 'users', ctx.userId);
  if (!me || (photo !== '' && !isPhoto(photo))) return workspace;
  if ((me.photo ?? '') === photo) return workspace;
  return putEntity(workspace, 'users', updateEntity(ctx, me, { photo }));
}
