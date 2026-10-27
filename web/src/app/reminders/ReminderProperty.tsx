import CheckRounded from '@mui/icons-material/CheckRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import NotificationsNoneRounded from '@mui/icons-material/NotificationsNoneRounded';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Divider,
  Switch,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { useState, type ReactNode } from 'react';
import { localTimeZone, timePart } from '../../core/dates.ts';
import {
  ALL_DAY_REMINDER_TIME,
  allDayReminder,
  allDayReminderTimeOf,
  reminderAnchor,
  reminderInstant,
  remindsAllDay,
  sameReminder,
  TIMED_PRESETS,
} from '../../core/reminders.ts';
import { updateTask } from '../../core/tasks.ts';
import type { Reminder, Task } from '../../core/types.ts';
import type { NotificationPermissionState } from '../../ports/notifier.ts';
import { TimeWheels } from '../dates/TimeWheels.tsx';
import { Wheel } from '../dates/Wheel.tsx';
import { formatTime } from '../format.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { PropertyRow, PropertySheet } from '../tasks/PropertyRow.tsx';
import { useReadOnly } from '../tasks/readOnly.ts';
import { notifier } from './notifier.ts';
import { daysEarlyText, minutesEarlyText, reminderLabel, reminderParts } from './reminderText.ts';
import { dateTimeFormat } from '../../core/intl.ts';

/**
 * The quick choices for an all-day task: days early, all at the person's time (TickTick's list),
 * counted from `from` (9:00 on a task).
 */
const allDayQuick = (time: string, from: string) =>
  [0, 1, 2, 3, 7].map((days) => allDayReminder(days, time, from));
const TIMED_QUICK: Reminder[] = TIMED_PRESETS.map((before) => ({ before }));

type CustomTab = 'day' | 'week' | 'minute' | 'hour';
const CHOICES: Record<CustomTab, readonly number[]> = {
  // Days early (Day), weeks early in days (Week), each at a time of day.
  day: Array.from({ length: 61 }, (_, i) => i),
  week: Array.from({ length: 13 }, (_, i) => i * 7),
  // A timed task, also: minutes early, by the minute or the hour.
  minute: Array.from({ length: 60 }, (_, i) => i),
  hour: Array.from({ length: 24 }, (_, i) => i * 60),
};
const byDays = (tab: CustomTab) => tab === 'day' || tab === 'week';

const dateText = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const clockOf = (at: number) =>
  dateTimeFormat('en-GB', {
    timeZone: localTimeZone(),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);

/** One choice in the list: its words, its time muted beside them, a tick when picked. */
function Choice({
  label,
  time,
  picked,
  disabled = false,
  trailing,
  onClick,
}: {
  label: string;
  time?: string | undefined;
  picked: boolean;
  disabled?: boolean;
  trailing?: ReactNode;
  onClick: () => void;
}) {
  return (
    <ButtonBase
      role="menuitemcheckbox"
      aria-checked={picked}
      disabled={disabled}
      onClick={onClick}
      sx={{
        width: '100%',
        justifyContent: 'flex-start',
        gap: 1,
        px: 2.5,
        py: 1.25,
        typography: 'body1',
        textAlign: 'left',
        color: picked ? 'primary.main' : disabled ? 'text.disabled' : 'text.primary',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Box component="span" sx={{ flexGrow: 1 }}>
        {label}
        {time && (
          <Box
            component="span"
            sx={{ ml: 0.75, color: picked ? 'primary.main' : 'text.secondary' }}
          >
            ({time})
          </Box>
        )}
      </Box>
      {picked && <CheckRounded fontSize="small" />}
      {trailing}
    </ButtonBase>
  );
}

/**
 * Making a reminder of one's own (spec: R-FB-60), like TickTick's Custom: Day or Week tabs with how
 * early and at what time of day ("60 days early at 16:00", R-FB-91), and for a timed task also
 * Minute and Hour tabs with how early. Below, when it will come, or that the time has passed.
 */
function CustomReminder({
  task,
  allDay,
  from,
  startTime,
  timeOfDay,
  onDone,
  onCancel,
}: {
  /** The task, to say when it will come; none in Settings */
  task: Task | null;
  allDay: boolean;
  /** What reminders count from: 9:00 for an all-day task, else the task's start time */
  from: string;
  /** The time wheel's first time: the person's all-day time (R-FB-83) or the task's start */
  startTime: string;
  /** Days early come at a time of day (off in Settings, where there is no start to count from) */
  timeOfDay: boolean;
  onDone: (reminder: Reminder) => void;
  onCancel: () => void;
}) {
  const [tab, setTab] = useState<CustomTab>(allDay ? 'day' : 'minute');
  const [days, setDays] = useState(1);
  const [time, setTime] = useState(startTime);
  const [minutes, setMinutes] = useState(5);
  // Now, as of opening Custom: enough to say a reminder has passed.
  const [now] = useState(() => Date.now());
  const reminder: Reminder = !byDays(tab)
    ? { before: minutes }
    : timeOfDay
      ? allDayReminder(days, time, from)
      : { before: days * 1440 };
  const at = task ? reminderInstant(task, reminder, localTimeZone()) : null;
  const expired = at !== null && at < now;
  const choices = CHOICES[tab];
  const value = byDays(tab) ? days : minutes;
  const shown = choices.includes(value) ? value : choices[0]!;
  const tabs: readonly CustomTab[] = allDay ? ['day', 'week'] : ['minute', 'hour', 'day', 'week'];

  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Tabs
        value={tab}
        onChange={(_, next: CustomTab) => {
          setTab(next);
          // Start the new tab's wheel on its first choice that is not the day itself.
          const first = CHOICES[next][1]!;
          if (byDays(next)) setDays(first);
          else setMinutes(first);
        }}
        variant="fullWidth"
        sx={{ px: 1.5, minHeight: 40, '& .MuiTab-root': { minHeight: 40, minWidth: 56 } }}
      >
        {tabs.map((each) => (
          <Tab key={each} value={each} label={t(`reminder.tab.${each}`)} />
        ))}
      </Tabs>
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 1 }}>
        <Wheel
          label={t('reminder.when')}
          options={choices}
          value={shown}
          format={(option) => (byDays(tab) ? daysEarlyText(option) : minutesEarlyText(option))}
          onChange={(next) => (byDays(tab) ? setDays(next) : setMinutes(next))}
          width={150}
        />
        {byDays(tab) && timeOfDay && <TimeWheels value={time} onChange={setTime} />}
      </Box>
      {task && (
        <Typography
          variant="body2"
          role="status"
          sx={{ px: 2.5, color: expired ? 'error.main' : 'text.secondary' }}
        >
          {at === null
            ? t('reminder.needsDate')
            : expired
              ? t('reminder.expired')
              : t('reminder.remindAt', {
                  time: formatTime(clockOf(at)),
                  date: dateText.format(at),
                })}
        </Typography>
      )}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, px: 1.5, pb: 1 }}>
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
        <Button variant="contained" disableElevation onClick={() => onDone(reminder)}>
          {t('common.done')}
        </Button>
      </Box>
    </Box>
  );
}

export interface ReminderDraft {
  reminders: Reminder[];
  constant: boolean;
}

/**
 * The reminder list (spec: PL-061, R-FB-60), set the way TickTick sets them: a list to tick any
 * of (on the day or on time, a few days or minutes early, each with its time), Custom for one of
 * your own, and Constant reminder to keep it coming until done. Nothing changes until OK. Task
 * details use it, and Settings for the reminder new tasks start with (R-FB-92).
 */
export function ReminderSheet({
  anchor,
  initial,
  task,
  allDay,
  from: fromGiven,
  note,
  showConstant = true,
  onSave,
  onClose,
}: {
  anchor: HTMLElement | null;
  initial: ReminderDraft;
  /** The task they are for; none in Settings */
  task: Task | null;
  allDay: boolean;
  /**
   * What the reminders count from, when there is no task to say: Settings counts new tasks'
   * reminders from the all-day time, or from the default time when new tasks have one (R-FB-92)
   */
  from?: string;
  /** A line at the top saying what these are for */
  note?: string;
  showConstant?: boolean;
  onSave: (draft: ReminderDraft) => void;
  onClose: () => void;
}) {
  const today = useToday();
  const allDayTime = allDayReminderTimeOf(useWorkspace());
  const [permission] = useState<NotificationPermissionState>(() => notifier().permission());
  const [draft, setDraft] = useState<ReminderDraft>(initial);
  const [custom, setCustom] = useState(false);
  // Opened again: start from what is saved.
  const [opened, setOpened] = useState(anchor);
  if (anchor !== opened) {
    setOpened(anchor);
    setDraft(initial);
    setCustom(false);
  }
  const taskAnchor = task ? reminderAnchor(task) : null;
  const dated = task === null || taskAnchor !== null;
  // What the reminders count from: 9:00 on an all-day task, else its start time.
  const start = (taskAnchor && timePart(taskAnchor)) ?? fromGiven ?? null;
  const from = fromGiven ?? (allDay ? ALL_DAY_REMINDER_TIME : (start ?? ALL_DAY_REMINDER_TIME));
  const picked = (reminder: Reminder) =>
    draft.reminders.some((each) => sameReminder(each, reminder));
  const toggle = (reminder: Reminder) =>
    setDraft((now) => ({
      ...now,
      reminders: now.reminders.some((each) => sameReminder(each, reminder))
        ? now.reminders.filter((each) => !sameReminder(each, reminder))
        : [...now.reminders, reminder],
    }));
  const quick = allDay ? allDayQuick(allDayTime, from) : TIMED_QUICK;
  // Picked ones the quick list does not have (custom times, set times) show under it.
  const others = draft.reminders.filter(
    (each) => !quick.some((choice) => sameReminder(choice, each)),
  );

  return (
    <PropertySheet label={t('reminder.dialog')} anchor={anchor} onClose={onClose}>
      {anchor && (
        <Box sx={{ width: { sm: 340 }, py: 1 }}>
          <Typography variant="h6" component="h2" sx={{ px: 2.5, pt: 1, pb: 1, fontSize: 18 }}>
            {custom ? t('reminder.custom') : t('reminder.dialog')}
          </Typography>
          {note && !custom && (
            <Typography variant="body2" color="text.secondary" sx={{ px: 2.5, pb: 1 }}>
              {note}
            </Typography>
          )}
          {permission === 'denied' && (
            <Alert severity="warning" variant="outlined" sx={{ mx: 2, mb: 1 }}>
              {t('reminder.blocked')}
            </Alert>
          )}
          {permission === 'unsupported' && (
            <Alert severity="info" variant="outlined" sx={{ mx: 2, mb: 1 }}>
              {t('reminder.unsupported')}
            </Alert>
          )}
          {custom ? (
            <CustomReminder
              task={task}
              allDay={allDay}
              from={from}
              startTime={allDay ? allDayTime : (start ?? allDayTime)}
              timeOfDay={allDay || start !== null}
              onCancel={() => setCustom(false)}
              onDone={(reminder) => {
                if (!picked(reminder)) toggle(reminder);
                setCustom(false);
              }}
            />
          ) : (
            <>
              {!dated && (
                <Typography variant="body2" color="text.secondary" sx={{ px: 2.5, pb: 1 }}>
                  {t('reminder.needsDate')}
                </Typography>
              )}
              <Box role="menu" aria-label={t('reminder.dialog')}>
                <Choice
                  label={t('reminder.none')}
                  picked={draft.reminders.length === 0}
                  onClick={() => setDraft({ ...draft, reminders: [] })}
                />
                {[...quick, ...others].map((reminder) => {
                  const { text, time } = reminderParts(reminder, allDay, today, from);
                  return (
                    <Choice
                      key={JSON.stringify(reminder)}
                      label={text}
                      time={time}
                      picked={picked(reminder)}
                      disabled={!dated && !('at' in reminder)}
                      onClick={() => toggle(reminder)}
                    />
                  );
                })}
                <Choice
                  label={t('reminder.custom')}
                  picked={false}
                  disabled={!dated}
                  trailing={<ChevronRightRounded fontSize="small" color="action" />}
                  onClick={() => setCustom(true)}
                />
              </Box>
              {showConstant && (
                <>
                  <Divider sx={{ my: 1, mx: 1.5 }} />
                  <Box sx={{ display: 'flex', alignItems: 'center', px: 2.5, gap: 1 }}>
                    <Box sx={{ flexGrow: 1 }}>
                      <Typography>{t('reminder.constant')}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t('reminder.constantHint')}
                      </Typography>
                    </Box>
                    <Switch
                      checked={draft.constant}
                      onChange={(event) => setDraft({ ...draft, constant: event.target.checked })}
                      slotProps={{ input: { 'aria-label': t('reminder.constant') } }}
                    />
                  </Box>
                </>
              )}
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 1,
                  px: 1.5,
                  pt: 1.5,
                  pb: 0.5,
                }}
              >
                <Button onClick={onClose}>{t('common.cancel')}</Button>
                <Button variant="contained" disableElevation onClick={() => onSave(draft)}>
                  {t('reminder.ok')}
                </Button>
              </Box>
            </>
          )}
        </Box>
      )}
    </PropertySheet>
  );
}

/** Reminders on a task (spec: PL-061, R-FB-60): the row in task details and its sheet. */
export function ReminderProperty({ task }: { task: Task }) {
  const apply = useApply();
  const today = useToday();
  const readOnly = useReadOnly();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const reminders = task.reminders ?? [];
  const allDay = remindsAllDay(task);
  const taskAnchor = reminderAnchor(task);
  const start = (taskAnchor && timePart(taskAnchor)) ?? null;
  const labels = reminders.map((each) => reminderLabel(each, allDay, today, start));
  if (readOnly && reminders.length === 0) return null;

  const save = (draft: ReminderDraft) => {
    apply((ctx, ws) =>
      updateTask(ctx, ws, task.id, {
        reminders: draft.reminders,
        constantReminder: draft.constant,
      }),
    );
    // The first reminder is the moment to ask (a click, so the browser shows the prompt).
    if (draft.reminders.length > reminders.length && notifier().permission() === 'default') {
      void notifier().request();
    }
    setAnchor(null);
  };

  return (
    <>
      <PropertyRow
        label={t('reminder.title')}
        icon={<NotificationsNoneRounded fontSize="small" />}
        ariaValue={labels.length ? labels.join(', ') : t('reminder.none')}
        onClick={setAnchor}
      >
        <Typography color={labels.length ? 'text.primary' : 'text.disabled'} noWrap>
          {labels.length ? labels.join(', ') : t('reminder.add')}
        </Typography>
      </PropertyRow>
      <ReminderSheet
        anchor={anchor}
        initial={{ reminders, constant: task.constantReminder === true }}
        task={task}
        allDay={allDay}
        onSave={save}
        onClose={() => setAnchor(null)}
      />
    </>
  );
}
