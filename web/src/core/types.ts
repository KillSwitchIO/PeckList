// Entity types. Must stay in step with schema/workspace.schema.json (checked by tests).

export type Id = string;
/** Hybrid logical clock timestamp, see hlc.ts */
export type Hlc = string;
/** UTC timestamp, e.g. 2026-10-20T16:15:02.113Z */
export type DateTime = string;
/** Local date (2026-11-03) or local date-time without offset (2026-11-03T09:00) */
export type LocalDateOrDateTime = string;
/** Fractional index key, see ordering.ts */
export type OrderKey = string;

export interface ElementState {
  in: boolean;
  hlc: Hlc;
}
/** Per-element last-writer-wins set: element id -> state */
export type ElementSet = Record<string, ElementState>;

export interface BaseEntity {
  id: Id;
  createdAt: DateTime;
  createdBy: Id;
  deletedAt: DateTime | null;
  /** Home server of the record, `local` in standalone mode */
  origin: string;
  /** field name -> HLC of its last write */
  _hlc: Record<string, Hlc>;
}

export interface User extends BaseEntity {
  handle: string;
  displayName: string;
  avatarColor: string;
  homeServer: string;
}

/** @deprecated Folders were dropped (lists + tags only); removed at the next schema change. */
export interface Folder extends BaseEntity {
  name: string;
  order: OrderKey;
}

export interface List extends BaseEntity {
  name: string;
  color: string;
  icon: string | null;
  /** @deprecated always null; see Folder */
  folderId: Id | null;
  visibility: 'private' | 'shared';
  archived: boolean;
  order: OrderKey;
  isInbox: boolean;
}

export interface Section extends BaseEntity {
  listId: Id;
  name: string;
  order: OrderKey;
}

export interface Tag extends BaseEntity {
  /** Path, e.g. `home/yard` for nested tags */
  name: string;
  color: string;
}

export interface Schedule {
  start: LocalDateOrDateTime;
  end: LocalDateOrDateTime | null;
  allDay: boolean;
  timeZone: string;
}

export interface Due {
  at: LocalDateOrDateTime;
  allDay: boolean;
  timeZone: string;
}

export type TaskStatus = 'open' | 'done' | 'wontdo';
export type Priority = 0 | 1 | 2 | 3;

export interface Task extends BaseEntity {
  title: string;
  notes: string;
  listId: Id;
  sectionId: Id | null;
  parentId: Id | null;
  order: OrderKey;
  status: TaskStatus;
  completedAt: DateTime | null;
  completedBy: Id | null;
  priority: Priority;
  schedule: Schedule | null;
  due: Due | null;
  tags: ElementSet;
  /** Keys are `user:<id>` or `group:<id>` */
  assignees: ElementSet;
  blockedBy: ElementSet;
  recurrence: string | null;
  /** Percent done, 0 to 100 in steps of 10. 0 means no progress is shown. */
  progress: number;
}

export interface Group extends BaseEntity {
  name: string;
  color: string;
  ownerId: Id;
  archived: boolean;
}

export interface GroupMember extends BaseEntity {
  groupId: Id;
  userId: Id;
  joinedAt: DateTime;
  state: 'invited' | 'active';
}

export interface ListMember extends BaseEntity {
  listId: Id;
  /** `user:<id>` or `group:<id>` */
  principal: string;
  role: 'owner' | 'editor' | 'viewer';
}

export interface Friendship extends BaseEntity {
  userA: Id;
  userB: Id;
  state: 'pending' | 'accepted';
}

export interface SavedFilter extends BaseEntity {
  name: string;
  query: Record<string, unknown>;
  order: OrderKey;
}

export interface Settings extends BaseEntity {
  userId: Id;
  themeMode: 'light' | 'dark' | 'system';
  palette: Record<string, string>;
  pointEventMinutes: number;
  dueSoonDays: number;
}

export interface EntityMap {
  users: User;
  folders: Folder;
  lists: List;
  sections: Section;
  tags: Tag;
  tasks: Task;
  groups: Group;
  groupMembers: GroupMember;
  listMembers: ListMember;
  friendships: Friendship;
  savedFilters: SavedFilter;
  settings: Settings;
}

export type CollectionName = keyof EntityMap;

export type Entities = { [K in CollectionName]: EntityMap[K][] };

export const COLLECTIONS: readonly CollectionName[] = [
  'users',
  'folders',
  'lists',
  'sections',
  'tags',
  'tasks',
  'groups',
  'groupMembers',
  'listMembers',
  'friendships',
  'savedFilters',
  'settings',
];

/** Fields that merge per element instead of as a whole value */
export const ELEMENT_SET_FIELDS: { readonly [K in CollectionName]: readonly string[] } = {
  users: [],
  folders: [],
  lists: [],
  sections: [],
  tags: [],
  tasks: ['tags', 'assignees', 'blockedBy'],
  groups: [],
  groupMembers: [],
  listMembers: [],
  friendships: [],
  savedFilters: [],
  settings: [],
};

export interface WorkspaceFile {
  schemaVersion: number;
  app: { name: 'punchlist'; version: string };
  owner: Id;
  node: string;
  entities: Entities;
  sync: { server: string | null; cursor: string | null };
}
