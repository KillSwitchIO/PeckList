import type { PlacedEvent } from '../../core/calendarEvents.ts';
import { t } from '../i18n/i18n.ts';
import { GroupSection } from '../views/GroupSection.tsx';
import { EventRow } from './EventRow.tsx';
import { useShownEvents } from './useCalendarEvents.ts';

/**
 * The shown calendars' events from `from` to `to`, as their own group at the top of a view
 * (spec: PL-134; the Manager's Q5: a group of their own rather than mixed into the tasks). Nothing
 * at all when there are none, or calendars are off. Over several days each row names its day.
 */
export function EventsGroup({
  from,
  to,
  groupKey,
}: {
  from: string;
  to: string;
  groupKey: string;
}) {
  const events = useShownEvents(from, to);
  if (events.length === 0) return null;
  return (
    <GroupSection groupKey={groupKey} title={t('calendars.group.events')} count={events.length}>
      <EventRows events={events} from={from} showDay={from !== to} />
    </GroupSection>
  );
}

/** Rows for events listed under a day (or from one), each with the day it falls on there. */
export function EventRows({
  events,
  from,
  showDay = false,
}: {
  events: readonly PlacedEvent[];
  from: string;
  showDay?: boolean;
}) {
  return events.map((placed) => (
    <EventRow
      key={placed.key}
      placed={placed}
      day={placed.first > from ? placed.first : from}
      showDay={showDay}
    />
  ));
}
