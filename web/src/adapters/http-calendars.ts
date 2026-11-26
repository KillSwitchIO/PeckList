import type {
  CalendarAccountInfo,
  CalendarAccounts,
  CalendarLinkInfo,
  CalendarResult,
  CalendarsApi,
  ShownEvent,
} from '../ports/calendars.ts';

/** A JSON request with the session cookie, as `createHttpSync` sends it. */
type Call = (
  path: string,
  init?: { method?: string; body?: unknown; keepalive?: boolean },
) => Promise<Response>;

/**
 * `/api/calendars` (PL-134). Refusals come back as the server's fixed code for the app to word,
 * never its message text: that can name a calendar host, and the person reads plain words instead.
 * Anything else that fails goes through `fail`, so offline and signed out read as everywhere else.
 */
export function createHttpCalendars(
  call: Call,
  fail: (response: Response) => Promise<never>,
  retryAfter: (response: Response) => number | null,
): CalendarsApi {
  const path = (id: string) => encodeURIComponent(id);
  /** The answer, or the refusal the person can act on. */
  const result = async <T>(response: Response): Promise<CalendarResult<T>> => {
    if (response.ok) return { ok: true, value: (await response.json()) as T };
    if (response.status === 429) {
      const seconds = retryAfter(response);
      return { ok: false, code: 'too_many', ...(seconds === null ? {} : { retryAfter: seconds }) };
    }
    if ([400, 404, 409, 502].includes(response.status)) {
      const body = (await response.json().catch(() => ({}))) as { error?: unknown };
      if (typeof body.error === 'string' && body.error !== '')
        return { ok: false, code: body.error };
      // A plain 404: the calendar or event is gone (or calendar sync was turned off meanwhile).
      if (response.status === 404) return { ok: false, code: 'calendar_not_found' };
    }
    return fail(response);
  };
  return {
    async list() {
      const response = await call('/api/calendars');
      if (!response.ok) return fail(response);
      const body = (await response.json()) as Partial<CalendarAccounts>;
      // A server from before Google could connect lists no kinds: CalDAV was all it had.
      return { accounts: body.accounts ?? [], providers: body.providers ?? ['caldav'] };
    },
    async connectCalDav(input) {
      return result<CalendarAccountInfo>(
        await call('/api/calendars/accounts', {
          method: 'POST',
          body: { provider: 'caldav', ...input },
        }),
      );
    },
    async disconnect(accountId) {
      const response = await call(`/api/calendars/accounts/${path(accountId)}`, {
        method: 'DELETE',
      });
      // Already gone is what was asked for.
      if (!response.ok && response.status !== 404) return fail(response);
    },
    async setMode(linkId, input) {
      return result<CalendarLinkInfo>(
        await call(`/api/calendars/${path(linkId)}`, { method: 'PUT', body: input }),
      );
    },
    async createCalendar(accountId, input) {
      return result<CalendarLinkInfo>(
        await call(`/api/calendars/accounts/${path(accountId)}/calendars`, {
          method: 'POST',
          body: input,
        }),
      );
    },
    async syncNow(linkId) {
      return result<CalendarLinkInfo>(
        await call(`/api/calendars/${path(linkId)}/sync`, { method: 'POST' }),
      );
    },
    async events(from, to) {
      const query = new URLSearchParams({ from, to });
      const response = await call(`/api/calendars/events?${query.toString()}`);
      if (!response.ok) return fail(response);
      return ((await response.json()) as { events: ShownEvent[] }).events;
    },
    async editEvent(id, edit) {
      return result<ShownEvent>(
        await call(`/api/calendars/events/${path(id)}`, { method: 'PATCH', body: edit }),
      );
    },
    async hide(id, occurrence, options) {
      const response = await call(`/api/calendars/events/${path(id)}/hide`, {
        method: 'POST',
        body: { occurrence },
        ...(options?.keepalive ? { keepalive: true } : {}),
      });
      // Gone already: nothing left to hide.
      if (!response.ok && response.status !== 404) return fail(response);
    },
    async makeTask(id, occurrence) {
      return result<{ taskId: string }>(
        await call(`/api/calendars/events/${path(id)}/task`, {
          method: 'POST',
          body: { occurrence },
        }),
      );
    },
  };
}
