import CloseRounded from '@mui/icons-material/CloseRounded';
import { Box, Button, IconButton, Paper, Tooltip, Typography } from '@mui/material';
import { useState } from 'react';
import { dueGroups, setDueDates, type DueGroupKey } from '../../core/agenda.ts';
import { addDays, localTimeZone } from '../../core/dates.ts';
import type { Id } from '../../core/types.ts';
import { DatePickerPanel } from '../dates/DatePickerPanel.tsx';
import { useToday } from '../hooks/useToday.ts';
import { t, type MessageKey } from '../i18n/i18n.ts';
import { Page } from '../layout/Page.tsx';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { PropertySheet } from '../tasks/PropertyRow.tsx';
import { TaskRow } from '../tasks/TaskRow.tsx';
import { EmptyState } from './EmptyState.tsx';
import { GroupSection } from './GroupSection.tsx';

const GROUP_TITLE: Record<DueGroupKey, MessageKey> = {
  overdue: 'due.group.overdue',
  today: 'due.group.today',
  tomorrow: 'due.group.tomorrow',
  week: 'due.group.week',
  later: 'due.group.later',
};

/**
 * Due dates (spec: PL-091): every open task with a due date, by deadline, built for fixing dates
 * in bulk. Select (or hold a row on a phone), pick tasks, then move them all at once. Each row's
 * date is its due date and edits in place.
 */
export function DueDatesView() {
  const workspace = useWorkspace();
  const today = useToday();
  const apply = useApply();
  const groups = dueGroups(workspace, today);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<Id>>(new Set());
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);
  // Only tasks still listed count (one may have closed or lost its date meanwhile).
  const listed = new Set(groups.flatMap((group) => group.tasks.map((task) => task.id)));
  const chosen = [...picked].filter((id) => listed.has(id));

  const stop = () => {
    setSelecting(false);
    setPicked(new Set());
  };
  const toggle = (ids: Id[], on: boolean) =>
    setPicked((before) => {
      const next = new Set(before);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  const move = (date: string | null) => {
    setPickerAnchor(null);
    if (chosen.length === 0) return;
    apply((ctx, ws) => setDueDates(ctx, ws, chosen, date, localTimeZone()), t('undo.dueChanged'));
    stop();
  };

  return (
    <Page
      title={t('nav.due')}
      actions={
        groups.length > 0 && (
          <Button
            size="small"
            aria-pressed={selecting}
            onClick={() => (selecting ? stop() : setSelecting(true))}
          >
            {selecting ? t('common.done') : t('due.select')}
          </Button>
        )
      }
    >
      {groups.length === 0 && <EmptyState title={t('due.empty')} hint={t('due.empty.hint')} />}
      {groups.map((group) => {
        const ids = group.tasks.map((task) => task.id);
        const all = ids.every((id) => picked.has(id));
        return (
          <GroupSection
            key={group.key}
            title={t(GROUP_TITLE[group.key])}
            count={group.tasks.length}
            actions={
              selecting && (
                <Button size="small" onClick={() => toggle(ids, !all)}>
                  {all ? t('due.selectNone') : t('due.selectAll')}
                </Button>
              )
            }
          >
            <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
              {group.tasks.map((task) => (
                <li key={task.id}>
                  <TaskRow
                    task={task}
                    showList
                    dueFirst
                    {...(selecting
                      ? {
                          select: {
                            selected: picked.has(task.id),
                            onToggle: () => toggle([task.id], !picked.has(task.id)),
                          },
                        }
                      : {
                          onHold: () => {
                            setSelecting(true);
                            setPicked(new Set([task.id]));
                          },
                        })}
                  />
                </li>
              ))}
            </Box>
          </GroupSection>
        );
      })}

      {selecting && (
        <Paper
          role="toolbar"
          aria-label={t('due.bar')}
          elevation={6}
          sx={{
            position: 'sticky',
            bottom: { xs: 'calc(52px + 8px + env(safe-area-inset-bottom))', sm: 16 },
            mt: 2,
            px: 1.5,
            py: 1,
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            columnGap: 0.5,
            rowGap: 0.5,
            borderRadius: 3,
            zIndex: 3,
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 600, mr: 'auto', pl: 0.5 }}>
            {t('due.selected', { count: chosen.length })}
          </Typography>
          <Tooltip title={t('due.stopSelecting')}>
            <IconButton
              size="small"
              aria-label={t('due.stopSelecting')}
              onClick={stop}
              sx={{ order: { xs: 0, sm: 1 } }}
            >
              <CloseRounded fontSize="small" />
            </IconButton>
          </Tooltip>
          <Box
            sx={{
              display: 'flex',
              gap: 0.5,
              flexBasis: { xs: '100%', sm: 'auto' },
              overflowX: 'auto',
              '& .MuiButton-root': { whiteSpace: 'nowrap', flexShrink: 0 },
            }}
          >
            <Button size="small" disabled={chosen.length === 0} onClick={() => move(today)}>
              {t('due.toToday')}
            </Button>
            <Button
              size="small"
              disabled={chosen.length === 0}
              onClick={() => move(addDays(today, 1))}
            >
              {t('due.toTomorrow')}
            </Button>
            <Button
              size="small"
              disabled={chosen.length === 0}
              onClick={() => move(addDays(today, 7))}
            >
              {t('due.toNextWeek')}
            </Button>
            <Button
              size="small"
              disabled={chosen.length === 0}
              aria-haspopup="dialog"
              onClick={(event) => setPickerAnchor(event.currentTarget)}
            >
              {t('due.pick')}
            </Button>
            <Button
              size="small"
              color="error"
              disabled={chosen.length === 0}
              onClick={() => move(null)}
            >
              {t('due.clear')}
            </Button>
          </Box>
        </Paper>
      )}
      <PropertySheet
        label={t('due.pick')}
        anchor={pickerAnchor}
        onClose={() => setPickerAnchor(null)}
      >
        {pickerAnchor && (
          <DatePickerPanel
            value={null}
            today={today}
            onApply={(value) => move(value?.date ?? null)}
            onCancel={() => setPickerAnchor(null)}
          />
        )}
      </PropertySheet>
    </Page>
  );
}
