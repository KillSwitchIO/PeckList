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
import { localTimeZone } from '../../core/dates.ts';
import {
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

/** The quick choices for an all-day task: days early, all at the person's time (TickTick's list). */
const allDayQuick = (time: string) => [0, 1, 2, 3, 7].map((days) => allDayReminder(days, time));
const TIMED_QUICK: Reminder[] = TIMED_PRESETS.map((before) => ({ before }));

type CustomTab = 'day' | 'week' | 'minute' | 'hour';
const CHOICES: Record<CustomTab, readonly number[]> = {
  // All day: days early (Day), weeks early in days (Week).
  day: Array.from({ length: 61 }, (_, i) => i),
  week: Array.from({ length: 13 }, (_, i) => i * 7),
  // Timed: minutes early, by the minute, the hour or the day.
  minute: Array.from({ length: 60 }, (_, i) => i),
  hour: Array.from({ length: 24 }, (_, i) => i * 60),
};
const TIMED_DAYS = Array.from({ length: 31 }, (_, i) => i * 1440);

const dateText = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const clockOf = (at: number) =>
  new Intl.DateTimeFormat('en-GB', {
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
 * Making a reminder of one's own (spec: R-FB-60), like TickTick's Custom: for an all-day task,
 * Day or Week tabs with how early and at what time; for a timed one, Minute, Hour or Day tabs
 * with how early. Below, when it will come, or that the time has passed.
 */
function CustomReminder({
  task,
  allDay,
  startTime,
  onDone,
  onCancel,
}: {
  task: Task;
  allDay: boolean;
  /** An all-day reminder's first time: the person's (R-FB-83) */
  startTime: string;
  onDone: (reminder: Reminder) => void;
  onCancel: () => void;
}) {
  const [tab, setTab] = useState<CustomTab>(allDay ? 'day' : 'minute');
  const [days, setDays] = useState(1);
  const [time, setTime] = useState(startTime);
  const [minutes, setMinutes] = useState(5);
  // Now, as of opening Custom: enough to say a reminder has passed.
  const [now] = useState(() => Date.now());
  const reminder: Reminder = allDay ? allDayReminder(days, time) : { before: minutes };
  const at = reminderInstant(task, reminder, localTimeZone());
  const expired = at !== null && at < now;
  const choices = !allDay && tab === 'day' ? TIMED_DAYS : CHOICES[tab];
  const value = allDay ? days : minutes;
  const shown = choices.includes(value) ? value : choices[0]!;
  const tabs: readonly CustomTab[] = allDay ? ['day', 'week'] : ['minute', 'hour', 'day'];

  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Tabs
        value={tab}
        onChange={(_, next: CustomTab) => {
          setTab(next);
          // Start the new tab's wheel on its first choice that is not the day itself.
          const first = (!allDay && next === 'day' ? TIMED_DAYS : CHOICES[next])[1]!;
          if (allDay) setDays(first);
          else setMinutes(first);
        }}
        sx={{ px: 1.5, minHeight: 40, '& .MuiTab-root': { minHeight: 40, minWidth: 64 } }}
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
          format={(option) => (allDay ? daysEarlyText(option) : minutesEarlyText(option))}
          onChange={(next) => (allDay ? setDays(next) : setMinutes(next))}
          width={150}
        />
        {allDay && <TimeWheels value={time} onChange={setTime} />}
      </Box>
      <Typography
        variant="body2"
        role="status"
        sx={{ px: 2.5, color: expired ? 'error.main' : 'text.secondary' }}
      >
        {at === null
          ? t('reminder.needsDate')
          : expired
            ? t('reminder.expired')
            : t('reminder.remindAt', { time: formatTime(clockOf(at)), date: dateText.format(at) })}
      </Typography>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, px: 1.5, pb: 1 }}>
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
        <Button variant="contained" disableElevation onClick={() => onDone(reminder)}>
          {t('common.done')}
        </Button>
      </Box>
    </Box>
  );
}

/**
 * Reminders on a task (spec: PL-061, R-FB-60), set the way TickTick sets them: a list to tick
 * any of (on the day or on time, a few days or minutes early, each with its time), Custom for
 * one of your own, and Constant reminder to keep it coming until done. Nothing changes until
 * OK. The first reminder asks the browser for permission to notify.
 */
export function ReminderProperty({ task }: { task: Task }) {
  const apply = useApply();
  const today = useToday();
  const readOnly = useReadOnly();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [permission, setPermission] = useState<NotificationPermissionState>(() =>
    notifier().permission(),
  );
  const reminders = task.reminders ?? [];
  // What the sheet shows, kept until OK.
  const [draft, setDraft] = useState<{ reminders: Reminder[]; constant: boolean } | null>(null);
  const [custom, setCustom] = useState(false);
  const allDay = remindsAllDay(task);
  const allDayTime = allDayReminderTimeOf(useWorkspace());
  const dated = reminderAnchor(task) !== null;
  const labels = reminders.map((each) => reminderLabel(each, allDay, today));
  if (readOnly && reminders.length === 0) return null;

  const open = (element: HTMLElement) => {
    setDraft({ reminders, constant: task.constantReminder === true });
    setCustom(false);
    setAnchor(element);
  };
  const close = () => {
    setAnchor(null);
    setDraft(null);
  };
  const save = () => {
    if (!draft) return;
    apply((ctx, ws) =>
      updateTask(ctx, ws, task.id, {
        reminders: draft.reminders,
        constantReminder: draft.constant,
      }),
    );
    // The first reminder is the moment to ask (a click, so the browser shows the prompt).
    if (draft.reminders.length > reminders.length && notifier().permission() === 'default') {
      void notifier().request().then(setPermission);
    }
    close();
  };
  const picked = (reminder: Reminder) =>
    draft?.reminders.some((each) => sameReminder(each, reminder)) ?? false;
  const toggle = (reminder: Reminder) =>
    setDraft(
      (now) =>
        now && {
          ...now,
          reminders: now.reminders.some((each) => sameReminder(each, reminder))
            ? now.reminders.filter((each) => !sameReminder(each, reminder))
            : [...now.reminders, reminder],
        },
    );
  const quick = allDay ? allDayQuick(allDayTime) : TIMED_QUICK;
  // Picked ones the quick list does not have (custom times, set times) show under it.
  const others = (draft?.reminders ?? []).filter(
    (each) => !quick.some((choice) => sameReminder(choice, each)),
  );

  return (
    <>
      <PropertyRow
        label={t('reminder.title')}
        icon={<NotificationsNoneRounded fontSize="small" />}
        ariaValue={labels.length ? labels.join(', ') : t('reminder.none')}
        onClick={open}
      >
        <Typography color={labels.length ? 'text.primary' : 'text.disabled'} noWrap>
          {labels.length ? labels.join(', ') : t('reminder.add')}
        </Typography>
      </PropertyRow>
      <PropertySheet label={t('reminder.dialog')} anchor={anchor} onClose={close}>
        {draft && (
          <Box sx={{ width: { sm: 340 }, py: 1 }}>
            <Typography variant="h6" component="h2" sx={{ px: 2.5, pt: 1, pb: 1, fontSize: 18 }}>
              {custom ? t('reminder.custom') : t('reminder.dialog')}
            </Typography>
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
                startTime={allDayTime}
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
                    const { text, time } = reminderParts(reminder, allDay, today);
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
                  <Button onClick={close}>{t('common.cancel')}</Button>
                  <Button variant="contained" disableElevation onClick={save}>
                    {t('reminder.ok')}
                  </Button>
                </Box>
              </>
            )}
          </Box>
        )}
      </PropertySheet>
    </>
  );
}
