import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import { putEntity } from './collections.ts';
import { createEntity } from './ops.ts';
import { setProfilePhoto } from './profile.ts';
import type { User, WorkspaceFile } from './types.ts';
import { createWorkspace } from './workspace.ts';

const ME = '01JBBEN0000000000000000001';

function mine() {
  const ctx = testContext('ben', undefined, ME);
  const made = createEntity<User>(ctx, {
    handle: 'ben@test',
    displayName: 'Ben',
    avatarColor: '#A7C7E7',
    homeServer: 'test',
  });
  const ws: WorkspaceFile = putEntity(createWorkspace(ctx), 'users', { ...made, id: ME });
  return { ctx, ws };
}

const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('profile photo', () => {
  it('sets, replaces and takes away the signed-in person’s photo', () => {
    const { ctx, ws: start } = mine();
    let ws = start;
    ws = setProfilePhoto(ctx, ws, PIXEL);
    const me = () => ws.entities.users.find((user) => user.id === ctx.userId)!;
    expect(me().photo).toBe(PIXEL);
    expect(me()._hlc.photo).toBeDefined();
    ws = setProfilePhoto(ctx, ws, '');
    expect(me().photo).toBe('');
  });

  it('refuses what is not a small image', () => {
    const { ctx, ws } = mine();
    expect(setProfilePhoto(ctx, ws, 'javascript:alert(1)')).toBe(ws);
    expect(setProfilePhoto(ctx, ws, `data:image/png;base64,${'A'.repeat(90_000)}`)).toBe(ws);
  });
});
