/** Closed tasks in one month (`yyyy-MM`, in the server's time zone). */
export interface MonthCount {
  month: string;
  closed: number;
}

/** One person's numbers (spec: Server stats). Counts only, never content. */
export interface UserStats {
  id: string;
  username: string;
  openTasks: number;
  closedTasks: number;
  closedThisMonth: number;
  createdTasks: number;
  lists: number;
  sharedLists: number;
  storageBytes: number;
  /** Devices that synced in the last 30 days. */
  devices: number;
  /** Their latest request or event the server still has on record. */
  lastActive: string | null;
  /** The last 12 months, oldest first. */
  closedByMonth: MonthCount[];
}

export interface ServerStats {
  computed: string;
  timeZone: string;
  users: number;
  openTasks: number;
  closedTasks: number;
  closedThisMonth: number;
  lists: number;
  sharedLists: number;
  storageBytes: number;
  closedByMonth: MonthCount[];
  people: UserStats[];
}
