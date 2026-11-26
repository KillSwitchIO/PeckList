import { Box, Button, ButtonBase, InputBase, Typography } from '@mui/material';
import { useState } from 'react';
import { useStore } from 'zustand';
import { addMinutes } from '../../core/calendar.ts';
import type { PlacedEvent } from '../../core/calendarEvents.ts';
import { addDays, datePart, localTimeZone, timePart } from '../../core/dates.ts';
import type { ShownEventEdit } from '../../ports/calendars.ts';
import { DatePickerPanel } from '../dates/DatePickerPanel.tsx';
import type { DateValue } from '../dates/dateValue.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { ProblemAlert } from '../layout/ProblemAlert.tsx';
import { useSyncState } from '../sync/syncContext.ts';
import { PropertySheet } from '../tasks/PropertyRow.tsx';
import { useTaskSelection } from '../tasks/selection.ts';
import { eventWhen, problemText } from './calendarText.ts';
import { useEventInk } from './eventInk.ts';
import { useCalendarOffline, useEventsStore, useHideEvent } from './useCalendarEvents.ts';
import type { EventsStore } from './eventsStore.ts';

/**
 * A shown event, opened from a row or the calendar (spec: PL-134 decision 2): which calendar,
 * its title, when, and its notes, editable in place for a single event on a writable calendar;
 * then "Make it a task" and Hide. A popover on bigger screens, a sheet on phones.
 */
export function EventPopover({
  placed,
  anchor,
  onClose,
}: {
  placed: PlacedEvent | null;
  anchor: HTMLElement | null;
  onClose: () => void;
}) {
  const store = useEventsStore();
  return (
    <PropertySheet
      label={t('calendars.event.label')}
      anchor={placed && store ? anchor : null}
      onClose={onClose}
    >
      {placed && store && (
        // Keyed by the event, so what was typed for one never shows in the next.
        <EventDetails key={placed.key} placed={placed} store={store} onClose={onClose} />
      )}
    </PropertySheet>
  );
}

/** What the date panel starts on: the event as the viewer sees it. */
function panelValue(placed: PlacedEvent): DateValue {
  if (placed.allDay) {
    return {
      date: placed.first,
      time: null,
      end: placed.end ? { date: placed.end, time: null } : null,
    };
  }
  return {
    date: datePart(placed.start),
    time: timePart(placed.start),
    end: placed.end ? { date: datePart(placed.end), time: timePart(placed.end) } : null,
  };
}

/** The panel's answer as the server takes an edit: all-day ends on the day after, as calendars do. */
function timesOf(value: DateValue): ShownEventEdit {
  if (value.time === null) {
    const last = value.end && value.end.date > value.date ? value.end.date : value.date;
    return { start: value.date, end: addDays(last, 1) };
  }
  const start = `${value.date}T${value.time}`;
  const given = value.end?.time ? `${value.end.date}T${value.end.time}` : null;
  return {
    start,
    end: given && given > start ? given : addMinutes(start, 30),
    timeZone: localTimeZone(),
  };
}

function EventDetails({
  placed,
  store,
  onClose,
}: {
  placed: PlacedEvent;
  store: EventsStore;
  onClose: () => void;
}) {
  const { event } = placed;
  const today = useToday();
  const offline = useCalendarOffline();
  const hide = useHideEvent();
  const syncNow = useSyncState((state) => state.syncNow);
  const { open } = useTaskSelection();
  const calendar = useStore(store, (state) => state.names[event.linkId] ?? null);
  const ink = useEventInk();
  const [title, setTitle] = useState(event.title);
  const [notes, setNotes] = useState(event.notes);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dates, setDates] = useState<HTMLElement | null>(null);
  const canEdit = event.editable && !offline;

  const save = async (edit: ShownEventEdit) => {
    setProblem(null);
    setBusy(true);
    try {
      const result = await store.edit(event, edit);
      if (!result.ok) {
        // What was typed goes back to what the calendar has; a newer copy is on its way.
        setTitle(event.title);
        setNotes(event.notes);
        setProblem(
          result.code === 'calendar_event_changed' || result.code === 'calendar_conflict'
            ? problemText(result.code)
            : t('calendars.event.saveFailed'),
        );
      }
    } catch {
      setTitle(event.title);
      setNotes(event.notes);
      setProblem(t('calendars.event.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const makeTask = async () => {
    setProblem(null);
    setBusy(true);
    try {
      const result = await store.makeTask(event);
      if (!result.ok) {
        setProblem(problemText(result.code));
        return;
      }
      onClose();
      // The server made the task: bring it here, then open it.
      await syncNow();
      open(result.value.taskId);
    } catch {
      setProblem(t('calendars.event.taskFailed'));
    } finally {
      setBusy(false);
    }
  };

  const readOnlyNote = offline
    ? t('calendars.event.offline')
    : event.editable
      ? null
      : event.recurring
        ? t('calendars.event.repeatingReadOnly')
        : t('calendars.event.calendarReadOnly');

  return (
    <Box sx={{ width: { xs: '100%', sm: 340 }, maxWidth: '100%', p: 2, display: 'grid', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 20 }}>
        <Box
          aria-hidden
          sx={{
            width: 10,
            height: 10,
            borderRadius: '3px',
            flexShrink: 0,
            bgcolor: ink(event.color),
          }}
        />
        <Typography variant="caption" color="text.secondary" noWrap>
          {calendar ?? t('calendars.event.calendar')}
        </Typography>
      </Box>
      {canEdit ? (
        <InputBase
          value={title}
          disabled={busy}
          placeholder={t('calendars.event.untitled')}
          inputProps={{ 'aria-label': t('calendars.event.title'), maxLength: 1000 }}
          onChange={(change) => setTitle(change.target.value)}
          onKeyDown={(key) => {
            if (key.key === 'Enter') {
              key.preventDefault();
              (key.target as HTMLElement).blur();
            }
          }}
          onBlur={() => {
            if (title !== event.title) void save({ title });
          }}
          sx={{ typography: 'subtitle1', fontWeight: 600 }}
        />
      ) : (
        // Text from outside the app: shown as text, never as markup (Security, PL-134 N3).
        <Typography variant="subtitle1" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
          {event.title || t('calendars.event.untitled')}
        </Typography>
      )}
      {canEdit ? (
        <ButtonBase
          disabled={busy}
          aria-label={t('calendars.event.changeWhen', { when: eventWhen(placed, today) })}
          onClick={(click) => setDates(click.currentTarget)}
          sx={{
            justifyContent: 'flex-start',
            textAlign: 'left',
            borderRadius: 1,
            mx: -0.5,
            px: 0.5,
            typography: 'body2',
            color: 'text.secondary',
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          {eventWhen(placed, today)}
        </ButtonBase>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {eventWhen(placed, today)}
        </Typography>
      )}
      {canEdit ? (
        <InputBase
          value={notes}
          multiline
          minRows={1}
          maxRows={8}
          disabled={busy}
          placeholder={t('calendars.event.notesPlaceholder')}
          inputProps={{ 'aria-label': t('calendars.event.notes'), maxLength: 20000 }}
          onChange={(change) => setNotes(change.target.value)}
          onBlur={() => {
            if (notes !== event.notes) void save({ notes });
          }}
          sx={{ typography: 'body2' }}
        />
      ) : (
        event.notes && (
          <Typography
            variant="body2"
            sx={{
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              maxHeight: 200,
              overflowY: 'auto',
            }}
          >
            {event.notes}
          </Typography>
        )
      )}
      {readOnlyNote && (
        <Typography variant="caption" color="text.secondary">
          {readOnlyNote}
        </Typography>
      )}
      <ProblemAlert problem={problem} />
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, pt: 0.5 }}>
        <Button size="small" disabled={busy || offline} onClick={() => void makeTask()}>
          {t('calendars.event.makeTask')}
        </Button>
        <Button
          size="small"
          color="inherit"
          disabled={busy || offline || !hide}
          onClick={() => {
            hide?.(event);
            onClose();
          }}
        >
          {t('calendars.event.hide')}
        </Button>
      </Box>
      <PropertySheet
        label={t('calendars.event.when')}
        anchor={dates}
        onClose={() => setDates(null)}
      >
        {dates && (
          <DatePickerPanel
            allowRange
            value={panelValue(placed)}
            today={today}
            onApply={(value) => {
              setDates(null);
              // A calendar event always has a date: clearing it changes nothing.
              if (value) void save(timesOf(value));
            }}
            onCancel={() => setDates(null)}
          />
        )}
      </PropertySheet>
    </Box>
  );
}
