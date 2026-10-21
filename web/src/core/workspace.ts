// Creating and reading workspace documents.

import { CURRENT_SCHEMA_VERSION } from './migrations.ts';
import { keyBetween } from './ordering.ts';
import { createEntity, type OpContext } from './ops.ts';
import type { Entities, List, Settings, User, WorkspaceFile } from './types.ts';

export const APP_VERSION = '0.1.0';

export function emptyEntities(): Entities {
  return {
    users: [],
    folders: [],
    lists: [],
    sections: [],
    tags: [],
    tasks: [],
    groups: [],
    groupMembers: [],
    listMembers: [],
    friendships: [],
    savedFilters: [],
    settings: [],
  };
}

export interface NewWorkspaceOptions {
  displayName?: string;
  handle?: string;
}

/** A fresh standalone workspace: the owner, their Inbox and default settings. */
export function createWorkspace(ctx: OpContext, options: NewWorkspaceOptions = {}): WorkspaceFile {
  const user = createEntity<User>(
    ctx,
    {
      handle: options.handle ?? 'me@local',
      displayName: options.displayName ?? 'Me',
      avatarColor: '#A7C7E7',
      homeServer: 'local',
    },
    ctx.userId,
  );
  const inbox = createEntity<List>(ctx, {
    name: 'Inbox',
    color: '#B8BCC4',
    icon: 'inbox',
    folderId: null,
    visibility: 'private',
    archived: false,
    order: keyBetween(null, null),
    isInbox: true,
  });
  const settings = createEntity<Settings>(ctx, {
    userId: ctx.userId,
    themeMode: 'system',
    palette: {},
    pointEventMinutes: 30,
    dueSoonDays: 2,
  });
  const entities = emptyEntities();
  entities.users.push(user);
  entities.lists.push(inbox);
  entities.settings.push(settings);
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    app: { name: 'punchlist', version: APP_VERSION },
    owner: ctx.userId,
    node: ctx.clock.node,
    entities,
    sync: { server: null, cursor: null },
  };
}

/** Stable, human-readable serialization used for export and files on disk. */
export function serializeWorkspace(workspace: WorkspaceFile): string {
  return `${JSON.stringify(workspace, null, 2)}\n`;
}
