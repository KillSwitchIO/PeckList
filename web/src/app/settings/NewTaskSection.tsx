import { Button, MenuItem, Switch, TextField } from '@mui/material';
import { useState } from 'react';
import { visibleLists } from '../../core/lists.ts';
import { newTaskDefaultsOf } from '../../core/newTaskDefaults.ts';
import { ALL_DAY_REMINDER_TIME, allDayReminderTimeOf } from '../../core/reminders.ts';
import { TimeField } from '../dates/TimeField.tsx';
import { formatTime } from '../format.ts';
import { ReminderSheet } from '../reminders/ReminderProperty.tsx';
import { reminderLabel } from '../reminders/reminderText.ts';
import { updateSettings } from '../../core/settings.ts';
import { canEditList } from '../../core/sharing.ts';
import type { NewTaskDefaults, Priority } from '../../core/types.ts';
import { t } from '../i18n/i18n.ts';
import { listName } from '../lists/listName.ts';
import { useApply, useStoreState, useWorkspace } from '../store/hooks.ts';
import { useSyncState } from '../sync/syncContext.ts';
import { Section, SettingRow } from './settingsLayout.tsx';

const DATES = ['none', 'today', 'tomorrow', 'nextWeek'] as const;
const PRIORITIES: Priority[] = [0, 1, 2, 3];
/** The Mess Drawer in the list select (its value must not be empty). */
const INBOX = 'inbox';

/**
 * Settings > New tasks (spec: PL-092), like TickTick's defaults: what a task starts with when
 * where it is added says nothing. A list page keeps its list, Today and a day keep their date, and
 * quick add's own words win over both.
 */
export function NewTaskSection() {
  const workspace = useWorkspace();
  const apply = useApply();
  const me = useStoreState((state) => state.context().userId);
  const phase = useSyncState((state) => state.phase);
  const authMode = useSyncState((state) => state.account?.authMode);
  const defaults = newTaskDefaultsOf(workspace);
  const change = (patch: Partial<NewTaskDefaults>) =>
    apply((ctx, ws) =>
      updateSettings(ctx, ws, { newTask: { ...newTaskDefaultsOf(ws), ...patch } }),
    );
  const lists = visibleLists(workspace).filter(
    (list) => !list.isInbox && canEditList(workspace, me, list.id),
  );
  const listValue =
    defaults.listId && lists.some((list) => list.id === defaults.listId) ? defaults.listId : INBOX;
  const date = defaults.date ?? 'none';
  const [reminderAnchor, setReminderAnchor] = useState<HTMLElement | null>(null);
  // The same list a new task's own reminders show (R-FB-92): an all-day one, counted from the
  // all-day time, unless new tasks start with a time of day.
  const allDayTime = allDayReminderTimeOf(workspace);
  const timed = date !== 'none' && Boolean(defaults.time);
  const reminderFrom = timed ? defaults.time! : allDayTime;
  const reminderText = defaults.reminders?.length
    ? defaults.reminders.map((each) => reminderLabel(each, !timed, '', reminderFrom)).join(', ')
    : t('reminder.none');
  return (
    <Section title={t('newTask.title')} hint={t('newTask.hint')}>
      <SettingRow label={t('newTask.list')} hint={t('newTask.listHint')}>
        <TextField
          select
          size="small"
          value={listValue}
          onChange={(event) =>
            change({ listId: event.target.value === INBOX ? null : event.target.value })
          }
          slotProps={{ htmlInput: { 'aria-label': t('newTask.list') } }}
        >
          <MenuItem value={INBOX}>{t('nav.inbox')}</MenuItem>
          {lists.map((list) => (
            <MenuItem key={list.id} value={list.id}>
              {listName(list, workspace)}
            </MenuItem>
          ))}
        </TextField>
      </SettingRow>
      <SettingRow label={t('task.priority')}>
        <TextField
          select
          size="small"
          value={defaults.priority ?? 0}
          onChange={(event) => change({ priority: Number(event.target.value) as Priority })}
          slotProps={{ htmlInput: { 'aria-label': t('task.priority') } }}
        >
          {PRIORITIES.map((priority) => (
            <MenuItem key={priority} value={priority}>
              {t(`priority.${priority}`)}
            </MenuItem>
          ))}
        </TextField>
      </SettingRow>
      <SettingRow label={t('newTask.date')} hint={t('newTask.dateHint')}>
        <TextField
          select
          size="small"
          value={date}
          onChange={(event) => change({ date: event.target.value as (typeof DATES)[number] })}
          slotProps={{ htmlInput: { 'aria-label': t('newTask.date') } }}
        >
          {DATES.map((each) => (
            <MenuItem key={each} value={each}>
              {t(`newTask.date.${each}`)}
            </MenuItem>
          ))}
        </TextField>
      </SettingRow>
      {date !== 'none' && (
        <SettingRow label={t('newTask.time')} hint={t('newTask.timeHint')}>
          <TimeField
            label={t('newTask.time')}
            value={defaults.time ?? null}
            emptyText={t('newTask.allDay')}
            onChange={(time) => change({ time })}
          />
        </SettingRow>
      )}
      <SettingRow label={t('newTask.reminder')} hint={t('newTask.reminderHint')}>
        {/* The same reminder list as a task's (R-FB-92), not a menu of its own. */}
        <Button
          variant="outlined"
          color="inherit"
          onClick={(event) => setReminderAnchor(event.currentTarget)}
          aria-label={`${t('newTask.reminder')}: ${reminderText}`}
          sx={{ textTransform: 'none', justifyContent: 'flex-start', minWidth: 160 }}
        >
          {reminderText}
        </Button>
        <ReminderSheet
          anchor={reminderAnchor}
          initial={{ reminders: defaults.reminders ?? [], constant: false }}
          task={null}
          allDay={!timed}
          from={reminderFrom}
          note={t('newTask.reminderNote', { time: formatTime(allDayTime) })}
          showConstant={false}
          onSave={(draft) => {
            change({ reminders: draft.reminders });
            setReminderAnchor(null);
          }}
          onClose={() => setReminderAnchor(null)}
        />
      </SettingRow>
      <SettingRow label={t('newTask.allDayTime')} hint={t('newTask.allDayTimeHint')}>
        <TimeField
          label={t('newTask.allDayTime')}
          value={allDayTime}
          onChange={(time) =>
            apply((ctx, ws) =>
              updateSettings(ctx, ws, { allDayReminderTime: time ?? ALL_DAY_REMINDER_TIME }),
            )
          }
        />
      </SettingRow>
      {phase === 'ready' && authMode === 'local' && (
        <SettingRow label={t('newTask.assignSelf')} hint={t('newTask.assignSelfHint')}>
          <Switch
            checked={defaults.assignSelf ?? true}
            onChange={(event) => change({ assignSelf: event.target.checked })}
            slotProps={{ input: { 'aria-label': t('newTask.assignSelf') } }}
          />
        </SettingRow>
      )}
    </Section>
  );
}
