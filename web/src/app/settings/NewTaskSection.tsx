import { MenuItem, Switch, TextField } from '@mui/material';
import { visibleLists } from '../../core/lists.ts';
import { newTaskDefaultsOf } from '../../core/newTaskDefaults.ts';
import { TIMED_PRESETS } from '../../core/reminders.ts';
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
/** No default reminder, in the reminder select. */
const NO_REMINDER = 'none';
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
  const first = defaults.reminders?.[0];
  const reminderChoice = first && 'before' in first ? String(first.before) : NO_REMINDER;
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
          <TextField
            type="time"
            size="small"
            value={defaults.time ?? ''}
            onChange={(event) => change({ time: event.target.value || null })}
            slotProps={{ htmlInput: { 'aria-label': t('newTask.time') } }}
          />
        </SettingRow>
      )}
      <SettingRow label={t('newTask.reminder')} hint={t('newTask.reminderHint')}>
        <TextField
          select
          size="small"
          value={reminderChoice}
          onChange={(event) => {
            const value = event.target.value;
            change({ reminders: value === NO_REMINDER ? [] : [{ before: Number(value) }] });
          }}
          slotProps={{ htmlInput: { 'aria-label': t('newTask.reminder') } }}
        >
          <MenuItem value={NO_REMINDER}>{t('reminder.none')}</MenuItem>
          {TIMED_PRESETS.map((before) => (
            <MenuItem key={before} value={String(before)}>
              {reminderLabel({ before }, false, '')}
            </MenuItem>
          ))}
        </TextField>
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
