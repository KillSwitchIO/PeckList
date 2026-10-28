import CheckRounded from '@mui/icons-material/CheckRounded';
import RepeatRounded from '@mui/icons-material/RepeatRounded';
import {
  Box,
  Button,
  FormControlLabel,
  ListItemIcon,
  ListItemText,
  MenuItem,
  MenuList,
  Radio,
  RadioGroup,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { addDays, datePart, localTimeZone, weekday } from '../../core/dates.ts';
import {
  formatRule,
  parseRule,
  WEEKDAY_ORDER,
  type ByDay,
  type Frequency,
  type Recurrence,
} from '../../core/recurrence.ts';
import { updateTask } from '../../core/tasks.ts';
import type { Task } from '../../core/types.ts';
import { weekStart } from '../format.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { useApply } from '../store/hooks.ts';
import { PropertyRow, PropertySheet } from '../tasks/PropertyRow.tsx';
import { useReadOnly } from '../tasks/readOnly.ts';
import { nthWeekday, repeatLabel, weekdayName } from './repeatText.ts';

/** The date a task's repeats count from: its start, else its due date. */
function anchorOf(task: Task): string | null {
  const at = task.schedule?.start ?? task.due?.at;
  return at ? datePart(at) : null;
}

/** Which of its weekday a date is in its month, as RRULE puts it (a fifth one: the last). */
function nthOf(date: string): ByDay {
  const day = Number(date.slice(8, 10));
  const nth = Math.ceil(day / 7);
  return { weekday: weekday(date), nth: nth === 5 ? -1 : nth };
}

/** The everyday choices, for a task on `date` (TickTick's list). */
function quickRules(date: string): Recurrence[] {
  const [, month, day] = date.split('-').map(Number) as [number, number, number];
  return [
    { freq: 'DAILY', interval: 1 },
    { freq: 'WEEKLY', interval: 1, byDay: [{ weekday: weekday(date) }] },
    { freq: 'WEEKLY', interval: 1, byDay: [1, 2, 3, 4, 5].map((each) => ({ weekday: each })) },
    { freq: 'MONTHLY', interval: 1, byMonthDay: [day] },
    { freq: 'YEARLY', interval: 1, byMonth: [month], byMonthDay: [day] },
  ];
}

type MonthBy = 'day' | 'nth' | 'last';
type Ends = 'never' | 'on' | 'after';

interface Draft {
  interval: string;
  freq: Frequency;
  days: number[];
  monthBy: MonthBy;
  ends: Ends;
  until: string;
  count: string;
  fromCompletion: boolean;
}

function draftOf(rule: Recurrence | null, date: string): Draft {
  const monthDay = rule?.byMonthDay?.[0];
  return {
    interval: String(rule?.interval ?? 1),
    freq: rule?.freq ?? 'WEEKLY',
    days: rule?.byDay?.filter((day) => day.nth === undefined).map((day) => day.weekday) ?? [
      weekday(date),
    ],
    monthBy: monthDay === -1 ? 'last' : rule?.byDay?.[0]?.nth ? 'nth' : 'day',
    ends: rule?.until ? 'on' : rule?.count !== undefined ? 'after' : 'never',
    until: rule?.until ?? addDays(date, 30),
    count: String(rule?.count ?? 10),
    fromCompletion: rule?.fromCompletion ?? false,
  };
}

/** The rule a custom draft describes, for a task on `date`. */
function ruleOf(draft: Draft, date: string): Recurrence {
  const rule: Recurrence = {
    freq: draft.freq,
    interval: Math.max(1, Math.round(Number(draft.interval)) || 1),
  };
  // From completion: just "every so often", so no weekdays or month days to land on.
  if (!draft.fromCompletion) {
    const [, month, day] = date.split('-').map(Number) as [number, number, number];
    if (draft.freq === 'WEEKLY') {
      rule.byDay = (draft.days.length ? draft.days : [weekday(date)]).map((each) => ({
        weekday: each,
      }));
    }
    if (draft.freq === 'MONTHLY') {
      if (draft.monthBy === 'nth') rule.byDay = [nthOf(date)];
      else rule.byMonthDay = [draft.monthBy === 'last' ? -1 : day];
    }
    if (draft.freq === 'YEARLY') {
      rule.byMonth = [month];
      rule.byMonthDay = [day];
    }
  } else {
    rule.fromCompletion = true;
  }
  if (draft.ends === 'on' && draft.until) rule.until = draft.until;
  if (draft.ends === 'after') rule.count = Math.max(1, Math.round(Number(draft.count)) || 1);
  return rule;
}

const UNITS: { freq: Frequency; key: Parameters<typeof t>[0] }[] = [
  { freq: 'DAILY', key: 'repeat.unitDays' },
  { freq: 'WEEKLY', key: 'repeat.unitWeeks' },
  { freq: 'MONTHLY', key: 'repeat.unitMonths' },
  { freq: 'YEARLY', key: 'repeat.unitYears' },
];

/**
 * How a task repeats (spec: PL-060): the everyday choices TickTick offers, and a custom rule
 * (every N days, weeks on chosen days, months on a day, a weekday or the last day, years; ending
 * never, on a date or after a number of times; counted from its date or from when it is done).
 */
export function RepeatProperty({ task }: { task: Task }) {
  const apply = useApply();
  const today = useToday();
  const readOnly = useReadOnly();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const label = repeatLabel(task.recurrence, today);
  if (readOnly && !task.recurrence) return null;

  const dated = anchorOf(task);
  const date = dated ?? today;
  const current = task.recurrence;
  const close = () => {
    setAnchor(null);
    setDraft(null);
  };
  const save = (rule: Recurrence | null) => {
    apply((ctx, ws) =>
      updateTask(ctx, ws, task.id, {
        recurrence: rule ? formatRule(rule) : null,
        // A repeat needs a date to count from: none yet, so it starts today.
        ...(rule && !dated
          ? { schedule: { start: today, end: null, allDay: true, timeZone: localTimeZone() } }
          : {}),
      }),
    );
    close();
  };
  const set = (patch: Partial<Draft>) => setDraft((was) => (was ? { ...was, ...patch } : was));
  const days = WEEKDAY_ORDER.slice(0).sort(
    (a, b) => ((a - weekStart() + 7) % 7) - ((b - weekStart() + 7) % 7),
  );

  return (
    <>
      <PropertyRow
        label={t('repeat.title')}
        icon={<RepeatRounded fontSize="small" />}
        ariaValue={label}
        onClick={setAnchor}
      >
        <Typography noWrap sx={{ color: current ? 'text.primary' : 'text.disabled' }}>
          {current ? label : t('repeat.add')}
        </Typography>
      </PropertyRow>
      <PropertySheet label={t('repeat.title')} anchor={anchor} onClose={close}>
        {draft === null ? (
          <Box sx={{ py: 1, width: { xs: '100%', sm: 300 } }}>
            {!dated && (
              <Typography variant="body2" color="text.secondary" sx={{ px: 2, pb: 1 }}>
                {t('repeat.startsToday')}
              </Typography>
            )}
            <MenuList aria-label={t('repeat.title')} autoFocusItem>
              {[null, ...quickRules(date)].map((rule) => {
                const text = rule ? formatRule(rule) : null;
                const chosen = text === (current ?? null);
                return (
                  <MenuItem key={text ?? 'none'} selected={chosen} onClick={() => save(rule)}>
                    <ListItemIcon>{chosen && <CheckRounded fontSize="small" />}</ListItemIcon>
                    <ListItemText>{repeatLabel(text, today)}</ListItemText>
                  </MenuItem>
                );
              })}
              <MenuItem onClick={() => setDraft(draftOf(parseRule(current), date))}>
                <ListItemIcon>
                  {current && !quickRules(date).some((rule) => formatRule(rule) === current) && (
                    <CheckRounded fontSize="small" />
                  )}
                </ListItemIcon>
                <ListItemText>{t('repeat.custom')}</ListItemText>
              </MenuItem>
            </MenuList>
          </Box>
        ) : (
          <Box sx={{ p: 2, width: { xs: '100%', sm: 340 }, display: 'grid', gap: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography>{t('repeat.every')}</Typography>
              <TextField
                type="number"
                size="small"
                value={draft.interval}
                onChange={(event) => set({ interval: event.target.value })}
                slotProps={{ htmlInput: { min: 1, 'aria-label': t('repeat.interval') } }}
                sx={{ width: 80 }}
              />
              <TextField
                select
                size="small"
                value={draft.freq}
                onChange={(event) => set({ freq: event.target.value as Frequency })}
                slotProps={{ htmlInput: { 'aria-label': t('repeat.unit') } }}
                sx={{ flexGrow: 1 }}
              >
                {UNITS.map((unit) => (
                  <MenuItem key={unit.freq} value={unit.freq}>
                    {t(unit.key)}
                  </MenuItem>
                ))}
              </TextField>
            </Box>
            {draft.freq === 'WEEKLY' && !draft.fromCompletion && (
              <ToggleButtonGroup
                aria-label={t('repeat.onDays')}
                size="small"
                fullWidth
                value={draft.days}
                onChange={(_, value: number[]) => set({ days: value })}
                sx={{
                  '& .Mui-selected, & .Mui-selected:hover': {
                    bgcolor: 'primary.main',
                    color: 'primary.contrastText',
                  },
                }}
              >
                {days.map((day) => (
                  <ToggleButton key={day} value={day} aria-label={weekdayName(day)}>
                    {weekdayName(day, true).slice(0, 2)}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            )}
            {draft.freq === 'MONTHLY' && !draft.fromCompletion && (
              <RadioGroup
                aria-label={t('repeat.monthBy')}
                value={draft.monthBy}
                onChange={(event) => set({ monthBy: event.target.value as MonthBy })}
              >
                <FormControlLabel
                  value="day"
                  control={<Radio size="small" />}
                  label={t('repeat.monthOnDay', { day: Number(date.slice(8, 10)) })}
                />
                <FormControlLabel
                  value="nth"
                  control={<Radio size="small" />}
                  label={t('repeat.monthOnNth', { when: nthWeekday(nthOf(date)) })}
                />
                <FormControlLabel
                  value="last"
                  control={<Radio size="small" />}
                  label={t('repeat.monthOnLast')}
                />
              </RadioGroup>
            )}
            <Box sx={{ display: 'grid', gap: 1 }}>
              <TextField
                select
                size="small"
                label={t('repeat.ends')}
                value={draft.ends}
                onChange={(event) => set({ ends: event.target.value as Ends })}
              >
                <MenuItem value="never">{t('repeat.endsNever')}</MenuItem>
                <MenuItem value="on">{t('repeat.endsOn')}</MenuItem>
                <MenuItem value="after">{t('repeat.endsAfter')}</MenuItem>
              </TextField>
              {draft.ends === 'on' && (
                <TextField
                  type="date"
                  size="small"
                  label={t('repeat.endDate')}
                  value={draft.until}
                  onChange={(event) => set({ until: event.target.value })}
                  slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: date } }}
                />
              )}
              {draft.ends === 'after' && (
                <TextField
                  type="number"
                  size="small"
                  label={t('repeat.count')}
                  value={draft.count}
                  onChange={(event) => set({ count: event.target.value })}
                  slotProps={{ htmlInput: { min: 1 } }}
                />
              )}
            </Box>
            <FormControlLabel
              control={
                <Switch
                  checked={draft.fromCompletion}
                  onChange={(event) => set({ fromCompletion: event.target.checked })}
                />
              }
              label={
                <Box>
                  <Typography>{t('repeat.fromCompletion')}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('repeat.fromCompletionHint')}
                  </Typography>
                </Box>
              }
            />
            <Typography variant="body2" color="text.secondary" aria-live="polite">
              {repeatLabel(formatRule(ruleOf(draft, date)), today)}
            </Typography>
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Button onClick={() => setDraft(null)}>{t('repeat.back')}</Button>
              <Button variant="contained" onClick={() => save(ruleOf(draft, date))}>
                {t('common.done')}
              </Button>
            </Box>
          </Box>
        )}
      </PropertySheet>
    </>
  );
}
