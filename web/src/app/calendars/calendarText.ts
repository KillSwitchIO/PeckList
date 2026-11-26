import type { PlacedEvent } from '../../core/calendarEvents.ts';
import { datePart, timePart } from '../../core/dates.ts';
import type { CalendarAccountInfo, CalendarLinkInfo } from '../../ports/calendars.ts';
import { formatDay, formatTime } from '../format.ts';
import { t } from '../i18n/i18n.ts';

// What Settings > Calendars and the event popover say, in words (spec: PL-134 batch rule:
// "problems shown in plain words"). The server's codes are fixed; its message text is never shown.

/** The words for a problem code from the server. Unknown codes read as a general problem. */
export function problemText(code: string): string {
  switch (code) {
    case 'calendar_auth_failed':
      return t('calendars.problem.auth');
    case 'calendar_unreachable':
    case 'calendar_unavailable':
    case 'calendar_timed_out':
      return t('calendars.problem.unreachable');
    case 'calendar_rate_limited':
      return t('calendars.problem.rateLimited');
    case 'calendar_address_blocked':
      return t('calendars.problem.blocked');
    case 'calendar_not_caldav':
      return t('calendars.problem.notCalDav');
    case 'calendar_not_found':
    case 'calendar_event_not_found':
      return t('calendars.problem.notFound');
    case 'calendar_forbidden':
    case 'calendar_refused':
      return t('calendars.problem.refused');
    case 'calendar_read_only':
      return t('calendars.problem.readOnly');
    case 'calendar_recurring_read_only':
    case 'calendar_occurrence_read_only':
      return t('calendars.event.repeatingReadOnly');
    case 'calendar_event_changed':
    case 'calendar_conflict':
      return t('calendars.problem.changed');
    case 'calendar_cannot_create':
      return t('calendars.problem.cannotCreate');
    case 'calendar_provider_unavailable':
      return t('calendars.problem.providerUnavailable');
    case 'calendar_google_client_changed':
      return t('calendars.problem.googleClientChanged');
    case 'invalid_url':
      return t('calendars.problem.invalidUrl');
    case 'invalid_username':
      return t('calendars.problem.invalidUsername');
    case 'invalid_password':
      return t('calendars.problem.invalidPassword');
    case 'invalid_name':
      return t('calendars.problem.invalidName');
    case 'invalid_time':
      return t('calendars.problem.invalidTime');
    case 'unknown_tag':
      return t('calendars.problem.unknownTag');
    case 'unknown_list':
      return t('calendars.problem.unknownList');
    case 'no_inbox':
      return t('calendars.problem.noInbox');
    case 'too_many':
      return t('calendars.problem.tooMany');
    default:
      return t('calendars.problem.failed');
  }
}

/**
 * What a Google sign-in came back with (`cal_connected`, `cal_cancelled`, ...), in words. The
 * server sends these to `/settings/calendars?calendar=`, and the Android app to `/settings?link=`.
 */
export function connectOutcome(outcome: string): { ok: boolean; text: string } {
  switch (outcome) {
    case 'cal_connected':
      return { ok: true, text: t('calendars.outcome.connected') };
    case 'cal_cancelled':
      return { ok: false, text: t('calendars.outcome.cancelled') };
    case 'cal_scope_missing':
      return { ok: false, text: t('calendars.outcome.scopeMissing') };
    case 'cal_expired':
      return { ok: false, text: t('calendars.outcome.expired') };
    case 'cal_auth_failed':
      return { ok: false, text: t('calendars.outcome.authFailed') };
    case 'cal_unreachable':
      return { ok: false, text: t('calendars.outcome.unreachable') };
    case 'cal_unavailable':
      return { ok: false, text: t('calendars.outcome.unavailable') };
    default:
      return { ok: false, text: t('calendars.outcome.failed') };
  }
}

/** The known CalDAV services, by the host of their address. */
const SERVICES: Record<string, string> = {
  'caldav.icloud.com': 'iCloud',
  'caldav.fastmail.com': 'Fastmail',
};

/** What an account is called on its card: the service's name, else the address's host. */
export function accountTitle(account: Pick<CalendarAccountInfo, 'provider' | 'serverUrl'>): string {
  if (account.provider === 'google') return 'Google';
  try {
    const host = new URL(account.serverUrl).hostname;
    return SERVICES[host] ?? (account.serverUrl.includes('/remote.php/dav') ? 'Nextcloud' : host);
  } catch {
    return t('calendars.caldav');
  }
}

/** The mode button's words: "Off", "Show events", or "Sync: tag". */
export function modeText(link: CalendarLinkInfo, tagName: (id: string) => string | null): string {
  if (link.mode === 'show') return t('calendars.mode.show');
  if (link.mode === 'sync') {
    const name = link.tagId ? tagName(link.tagId) : null;
    return name ? t('calendars.mode.syncWith', { tag: name }) : t('calendars.mode.sync');
  }
  return t('calendars.mode.off');
}

/** When an event is, for the popover: "Tue, Dec 1, 10:00 - 10:45", or its days when all day. */
export function eventWhen(placed: PlacedEvent, today: string): string {
  const first = formatDay(placed.first, today);
  if (placed.allDay) {
    return placed.end
      ? t('calendars.event.days', { first, last: formatDay(placed.end, today) })
      : first;
  }
  const from = formatTime(timePart(placed.start) ?? '00:00');
  const to = placed.end ? formatTime(timePart(placed.end) ?? '00:00') : null;
  if (!to) return `${first}, ${from}`;
  // An event into another day names both days.
  if (placed.end && datePart(placed.end) !== placed.first && placed.last !== placed.first) {
    return t('calendars.event.days', {
      first: `${first}, ${from}`,
      last: `${formatDay(placed.last, today)}, ${to}`,
    });
  }
  return t('calendars.event.times', { day: first, from, to });
}

/** The time a list row shows on the right: the start, or "All day". */
export function rowTime(placed: PlacedEvent, day: string): string {
  if (placed.allDay) return t('calendars.event.allDay');
  // A timed event begun the day before shows where it ends.
  if (placed.first < day && placed.end) {
    return t('calendars.event.until', { time: formatTime(timePart(placed.end) ?? '00:00') });
  }
  return formatTime(timePart(placed.start) ?? '00:00');
}
