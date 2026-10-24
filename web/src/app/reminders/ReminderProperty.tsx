import NotificationsNoneRounded from '@mui/icons-material/NotificationsNoneRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  IconButton,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import {
  ALL_DAY_PRESETS,
  reminderAnchor,
  remindsAllDay,
  sameReminder,
  TIMED_PRESETS,
} from '../../core/reminders.ts';
import { updateTask } from '../../core/tasks.ts';
import type { Reminder, Task } from '../../core/types.ts';
import type { NotificationPermissionState } from '../../ports/notifier.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { useApply } from '../store/hooks.ts';
import { PropertyRow, PropertySheet } from '../tasks/PropertyRow.tsx';
import { useReadOnly } from '../tasks/readOnly.ts';
import { notifier } from './notifier.ts';
import { reminderLabel } from './reminderText.ts';

/**
 * Reminders on a task (spec: PL-061), set the way TickTick sets them: on time, 5 or 30 minutes,
 * an hour or a day before (an all-day task: on the day at 9:00, a day, two days or a week before),
 * and any number of set times. The first one asks the browser for permission to notify.
 */
export function ReminderProperty({ task }: { task: Task }) {
  const apply = useApply();
  const today = useToday();
  const readOnly = useReadOnly();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [permission, setPermission] = useState<NotificationPermissionState>(() =>
    notifier().permission(),
  );
  const [custom, setCustom] = useState('');
  const reminders = task.reminders ?? [];
  const allDay = remindsAllDay(task);
  const dated = reminderAnchor(task) !== null;
  const labels = reminders.map((each) => reminderLabel(each, allDay, today));
  if (readOnly && reminders.length === 0) return null;

  const save = (next: Reminder[]) => {
    apply((ctx, ws) => updateTask(ctx, ws, task.id, { reminders: next }));
    // The first reminder is the moment to ask (a click, so the browser shows the prompt).
    if (next.length > reminders.length && notifier().permission() === 'default') {
      void notifier().request().then(setPermission);
    }
  };
  const toggle = (reminder: Reminder, on: boolean) =>
    save(
      on
        ? [...reminders.filter((each) => !sameReminder(each, reminder)), reminder]
        : reminders.filter((each) => !sameReminder(each, reminder)),
    );
  const presets = allDay ? ALL_DAY_PRESETS : TIMED_PRESETS;
  const sets = reminders.filter((each): each is { at: string } => 'at' in each);

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
      <PropertySheet label={t('reminder.title')} anchor={anchor} onClose={() => setAnchor(null)}>
        <Box sx={{ p: 2, width: { sm: 320 }, display: 'grid', gap: 1 }}>
          {permission === 'denied' && (
            <Alert severity="warning" variant="outlined">
              {t('reminder.blocked')}
            </Alert>
          )}
          {permission === 'unsupported' && (
            <Alert severity="info" variant="outlined">
              {t('reminder.unsupported')}
            </Alert>
          )}
          {!dated && (
            <Typography variant="body2" color="text.secondary">
              {t('reminder.needsDate')}
            </Typography>
          )}
          <Box sx={{ display: 'grid' }}>
            {presets.map((before) => {
              const reminder = { before };
              const on = reminders.some((each) => sameReminder(each, reminder));
              return (
                <FormControlLabel
                  key={before}
                  disabled={!dated}
                  control={
                    <Checkbox
                      size="small"
                      checked={on}
                      onChange={(event) => toggle(reminder, event.target.checked)}
                    />
                  }
                  label={reminderLabel(reminder, allDay, today)}
                />
              );
            })}
          </Box>
          {sets.map((each) => {
            const label = reminderLabel(each, allDay, today);
            return (
              <Box key={each.at} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography sx={{ flexGrow: 1 }}>{label}</Typography>
                <IconButton
                  size="small"
                  aria-label={t('reminder.remove', { when: label })}
                  onClick={() => toggle(each, false)}
                >
                  <CloseRounded fontSize="small" />
                </IconButton>
              </Box>
            );
          })}
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <TextField
              type="datetime-local"
              size="small"
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              slotProps={{ htmlInput: { 'aria-label': t('reminder.at') } }}
              sx={{ flexGrow: 1 }}
            />
            <Button
              disabled={!custom}
              onClick={() => {
                toggle({ at: custom.slice(0, 16) }, true);
                setCustom('');
              }}
            >
              {t('reminder.addAt')}
            </Button>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={() => setAnchor(null)}>{t('common.done')}</Button>
          </Box>
        </Box>
      </PropertySheet>
    </>
  );
}
