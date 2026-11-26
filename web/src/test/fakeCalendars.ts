import { eventKey } from '../core/calendarEvents.ts';
import type {
  CalendarAccountInfo,
  CalendarAccounts,
  CalendarLinkInfo,
  CalendarResult,
  CalendarsApi,
  ShownEvent,
} from '../ports/calendars.ts';
import { SyncFailure } from '../ports/sync.ts';

/** A calendar as the fake server would find it on connecting. */
export function fakeLink(over: Partial<CalendarLinkInfo> = {}): CalendarLinkInfo {
  return {
    id: 'link-home',
    name: 'Home',
    color: '#3366cc',
    readOnly: false,
    mode: 'off',
    tagId: null,
    listId: null,
    madeByPeckList: false,
    syncedAt: null,
    problem: null,
    nextAttempt: null,
    ...over,
  };
}

/** A shown event on `day` (a floating time, so it shows as written in any zone). */
export function fakeEvent(day: string, over: Partial<ShownEvent> = {}): ShownEvent {
  return {
    id: 'ev-dentist',
    linkId: 'link-home',
    occurrence: day,
    title: 'Dentist',
    notes: 'Bring the referral letter.',
    start: `${day}T10:00`,
    end: `${day}T10:45`,
    allDay: false,
    timeZone: null,
    recurring: false,
    editable: true,
    color: '#3366cc',
    ...over,
  };
}

/**
 * `/api/calendars` in memory (PL-134): the accounts connected, the events of shown calendars, and
 * what was asked of it, so a test reads what the server heard.
 */
export class FakeCalendars implements CalendarsApi {
  accounts: CalendarAccountInfo[] = [];
  /** The shown calendars' events the server has. */
  shown: ShownEvent[] = [];
  /** What a CalDAV connect finds on the server. */
  discoverable: CalendarLinkInfo[] = [fakeLink()];
  /** The next connect is refused with this code. */
  refuseConnect: string | null = null;
  /** Each change asked for, in order (never a password). */
  readonly calls: string[] = [];
  /** Event fetches asked for, as `from..to`. */
  readonly fetches: string[] = [];
  /** The kinds the server can connect: add `google` for a server with a Google client. */
  providers = ['caldav'];
  /** No answer: as an unreachable server. */
  offline = false;
  /** Sync now answers 429 after this many. */
  syncsAllowed = Infinity;
  private hidden = new Set<string>();
  private made = 0;

  private check() {
    if (this.offline) throw new SyncFailure('offline', 'offline');
  }

  private link(id: string): CalendarLinkInfo | undefined {
    return this.accounts.flatMap((account) => account.calendars).find((each) => each.id === id);
  }

  private replace(link: CalendarLinkInfo) {
    this.accounts = this.accounts.map((account) => ({
      ...account,
      calendars: account.calendars.map((each) => (each.id === link.id ? link : each)),
    }));
  }

  list(): Promise<CalendarAccounts> {
    this.check();
    return Promise.resolve({
      accounts: structuredClone(this.accounts),
      providers: [...this.providers],
    });
  }

  connectCalDav(input: {
    serverUrl: string;
    username: string;
    password: string;
  }): Promise<CalendarResult<CalendarAccountInfo>> {
    this.check();
    this.calls.push(
      `connect ${input.serverUrl} ${input.username} ${input.password ? 'with-password' : ''}`,
    );
    if (this.refuseConnect) return Promise.resolve({ ok: false, code: this.refuseConnect });
    this.made += 1;
    const account: CalendarAccountInfo = {
      id: `acc-${this.made}`,
      provider: 'caldav',
      name: input.username,
      serverUrl: input.serverUrl,
      username: input.username,
      status: 'ok',
      problem: null,
      canCreateCalendar: true,
      calendars: this.discoverable.map((each) => ({ ...each, id: `${each.id}-${this.made}` })),
    };
    this.accounts.push(account);
    return Promise.resolve({ ok: true, value: structuredClone(account) });
  }

  disconnect(accountId: string): Promise<void> {
    this.check();
    this.calls.push(`disconnect ${accountId}`);
    this.accounts = this.accounts.filter((each) => each.id !== accountId);
    return Promise.resolve();
  }

  setMode(
    linkId: string,
    input: { mode: CalendarLinkInfo['mode']; tagId?: string; listId?: string },
  ): Promise<CalendarResult<CalendarLinkInfo>> {
    this.check();
    this.calls.push(
      `mode ${linkId} ${input.mode}${input.tagId ? ` tag:${input.tagId}` : ''}${input.listId ? ` list:${input.listId}` : ''}`,
    );
    const link = this.link(linkId);
    if (!link) return Promise.resolve({ ok: false, code: 'calendar_not_found' });
    if (input.mode === 'sync' && link.readOnly) {
      return Promise.resolve({ ok: false, code: 'calendar_read_only' });
    }
    const next = {
      ...link,
      mode: input.mode,
      tagId: input.mode === 'sync' ? (input.tagId ?? null) : null,
      listId: input.mode === 'sync' ? (input.listId ?? null) : null,
    };
    this.replace(next);
    return Promise.resolve({ ok: true, value: next });
  }

  createCalendar(
    accountId: string,
    input: { name: string; tagId: string; listId?: string },
  ): Promise<CalendarResult<CalendarLinkInfo>> {
    this.check();
    this.calls.push(`create ${accountId} ${input.name} tag:${input.tagId}`);
    const link = fakeLink({
      id: `made-${input.name}`,
      name: input.name,
      mode: 'sync',
      tagId: input.tagId,
      madeByPeckList: true,
    });
    this.accounts = this.accounts.map((account) =>
      account.id === accountId ? { ...account, calendars: [...account.calendars, link] } : account,
    );
    return Promise.resolve({ ok: true, value: link });
  }

  syncNow(linkId: string): Promise<CalendarResult<CalendarLinkInfo>> {
    this.check();
    this.calls.push(`sync ${linkId}`);
    if (this.syncsAllowed <= 0)
      return Promise.resolve({ ok: false, code: 'too_many', retryAfter: 40 });
    this.syncsAllowed -= 1;
    const link = this.link(linkId);
    if (!link) return Promise.resolve({ ok: false, code: 'calendar_not_found' });
    const next = { ...link, syncedAt: new Date().toISOString() };
    this.replace(next);
    return Promise.resolve({ ok: true, value: next });
  }

  events(from: string, to: string): Promise<ShownEvent[]> {
    this.check();
    this.fetches.push(`${from}..${to}`);
    return Promise.resolve(
      this.shown.filter(
        (each) =>
          each.occurrence >= from &&
          each.occurrence <= to &&
          !this.hidden.has(eventKey(each)) &&
          !this.hidden.has(`${each.id}|*`),
      ),
    );
  }

  editEvent(
    id: string,
    edit: { title?: string; notes?: string; start?: string; end?: string; timeZone?: string },
  ): Promise<CalendarResult<ShownEvent>> {
    this.check();
    this.calls.push(`edit ${id} ${JSON.stringify(edit)}`);
    const found = this.shown.find((each) => each.id === id);
    if (!found) return Promise.resolve({ ok: false, code: 'calendar_not_found' });
    if (found.recurring)
      return Promise.resolve({ ok: false, code: 'calendar_recurring_read_only' });
    const next = { ...found, ...edit, occurrence: (edit.start ?? found.start).slice(0, 10) };
    this.shown = this.shown.map((each) => (each.id === id ? next : each));
    return Promise.resolve({ ok: true, value: next });
  }

  hide(id: string, occurrence: string | null, options?: { keepalive?: boolean }): Promise<void> {
    this.check();
    this.calls.push(`hide ${id} ${occurrence ?? 'all'}${options?.keepalive ? ' keepalive' : ''}`);
    this.hidden.add(occurrence ? `${id}|${occurrence}` : `${id}|*`);
    return Promise.resolve();
  }

  makeTask(id: string, occurrence: string | null): Promise<CalendarResult<{ taskId: string }>> {
    this.check();
    this.calls.push(`task ${id} ${occurrence ?? 'all'}`);
    this.hidden.add(occurrence ? `${id}|${occurrence}` : `${id}|*`);
    return Promise.resolve({ ok: true, value: { taskId: 'TASK-FROM-EVENT' } });
  }
}
