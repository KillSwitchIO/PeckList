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
  /** Their picture as a data URL, cropped square to its circle (schema 14); empty or absent: initials */
  photo?: string;
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
  /** Set when an admin hands the list to someone else; absent: its creator owns it (schema 9) */
  ownerId?: Id;
}

/** @deprecated Sections were dropped (PL-011); old ones fold into their list (flattenSections). */
export interface Section extends BaseEntity {
  listId: Id;
  name: string;
  order: OrderKey;
}

export interface Tag extends BaseEntity {
  /** Path, e.g. `home/yard` for nested tags */
  name: string;
  color: string;
  /** Order among its sibling tags */
  order: OrderKey;
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
  /** @deprecated Always null now (sections were dropped, PL-011); old data still has values. */
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
  /** When it was pinned to the top of its views; null or absent: not pinned (schema 8). */
  pinnedAt?: DateTime | null;
  /** When to remind about it (schema 12); absent or empty: never */
  reminders?: Reminder[];
  /** Its reminders stay up and come again every 5 minutes for an hour until done (schema 15) */
  constantReminder?: boolean;
}

/**
 * A reminder (schema 12): minutes before the task's date (an all-day task's date counts from
 * 9:00 that day), or a set local date-time.
 */
export type Reminder = { before: number } | { at: LocalDateOrDateTime };

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
  /** The admin who made it, by their username then (schema 6); absent when the two made it. */
  madeBy?: { id: Id; name: string } | null;
}

export interface SavedFilter extends BaseEntity {
  name: string;
  query: Record<string, unknown>;
  order: OrderKey;
}

export interface SidebarLayout {
  /** Every view once, plus the `@group` marker: views after it sit in the collapsible group. */
  order: string[];
  hidden: string[];
  groupOpen: boolean;
}

export interface Settings extends BaseEntity {
  userId: Id;
  themeMode: 'light' | 'dark' | 'system';
  palette: Record<string, string>;
  pointEventMinutes: number;
  dueSoonDays: number;
  /** Times on a 12-hour (default) or 24-hour clock */
  clockFormat?: '12h' | '24h';
  /** First day of the week in calendars: 0 Sunday (default), 1 Monday */
  weekStart?: 0 | 1;
  /** IANA time zone the person picked; null or absent: the server's, else the device's (schema 8) */
  timeZone?: string | null;
  sidebar: SidebarLayout;
  /** The phone bottom bar's tabs before More, in order; absent: the default ones (schema 9) */
  bottomBar?: string[];
  /** The named palette the colors start from; `palette` holds changes on top (schema 11) */
  palettePreset?: string;
  /** How dates show, as a pattern (core/dateFormat.ts; schema 13); absent: the language's own */
  dateFormat?: string;
  /** What a new task starts with when where it is added says nothing (schema 10, PL-092) */
  newTask?: NewTaskDefaults;
}

/** The person's defaults for new tasks; each absent field keeps the built-in behavior. */
export interface NewTaskDefaults {
  /** List for tasks added outside a list; null or absent: the Mess Drawer */
  listId?: Id | null;
  priority?: Priority;
  /** Start date for tasks added where no date applies */
  date?: 'none' | 'today' | 'tomorrow' | 'nextWeek';
  /** Time on that date (HH:mm); null or absent: all day */
  time?: string | null;
  /** Assign tasks I add to shared lists to me (absent: yes) */
  assignSelf?: boolean;
  /** Reminders a new task starts with (schema 12); they apply once it has a date */
  reminders?: Reminder[];
}

/** A comment on a task (schema 7). `createdBy` is its author. */
export interface Comment extends BaseEntity {
  taskId: Id;
  /** Markdown */
  body: string;
  /** When the author last changed it; null when never */
  editedAt: DateTime | null;
}

/** A file on a task (schema 8): its description; the file is stored by its sha256. */
export interface Attachment extends BaseEntity {
  taskId: Id;
  name: string;
  /** Bytes */
  size: number;
  mime: string;
  /** Lowercase hex; also the file's key in every blob store */
  sha256: string;
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
  comments: Comment;
  attachments: Attachment;
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
  'comments',
  'attachments',
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
  comments: [],
  attachments: [],
};

export interface WorkspaceFile {
  schemaVersion: number;
  app: { name: 'punchlist'; version: string };
  owner: Id;
  node: string;
  entities: Entities;
  sync: { server: string | null; cursor: string | null };
}
