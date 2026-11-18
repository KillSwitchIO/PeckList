import CheckRounded from '@mui/icons-material/CheckRounded';
import PersonOutlineRounded from '@mui/icons-material/PersonOutlineRounded';
import {
  Badge,
  Box,
  Button,
  IconButton,
  Link,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { countsAsDone, doneByDay, doneTotals, heatWeeks } from '../../core/completions.ts';
import { localDayOf, localTimeZone } from '../../core/dates.ts';
import { completedTasks } from '../../core/queries.ts';
import { purgeDaysOf } from '../../core/settings.ts';
import { describePrincipal } from '../../core/sharing.ts';
import type { Id } from '../../core/types.ts';
import { Avatar } from '../friends/Avatar.tsx';
import { formatDay, weekStart } from '../format.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { Page } from '../layout/Page.tsx';
import { purgePeriod } from '../settings/purgePeriod.ts';
import { useStoreState, useWorkspace } from '../store/hooks.ts';
import { TaskRows } from '../tasks/TaskRow.tsx';
import { closedDay, groupClosed } from './closedGroups.ts';
import { CompletedHeatmap } from './CompletedHeatmap.tsx';
import { EmptyState } from './EmptyState.tsx';
import { GroupSection } from './GroupSection.tsx';
import { useNarrowed } from './useNarrowed.tsx';
import { useReveal } from './useReveal.tsx';

/** One of the totals over the heatmap: the number, and what it counts. */
function Total({ label, value }: { label: string; value: number }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="h6" component="p" sx={{ lineHeight: 1.2 }}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Box>
  );
}

/** Who completed them, when more than one person did: anyone, or one of them. */
function CompletedByButton({
  people,
  value,
  onChange,
}: {
  people: { id: Id; name: string; color: string; photo: string | null }[];
  value: Id | null;
  onChange: (id: Id | null) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const pick = (id: Id | null) => {
    onChange(id);
    setAnchor(null);
  };
  return (
    <>
      <Tooltip title={t('completed.by')}>
        <IconButton
          aria-label={t('completed.by')}
          aria-haspopup="menu"
          onClick={(event) => setAnchor(event.currentTarget)}
        >
          <Badge color="primary" variant="dot" invisible={value === null}>
            <PersonOutlineRounded />
          </Badge>
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        <MenuItem selected={value === null} onClick={() => pick(null)}>
          <ListItemIcon>{value === null && <CheckRounded fontSize="small" />}</ListItemIcon>
          <ListItemText>{t('completed.byAnyone')}</ListItemText>
        </MenuItem>
        {people.map((person) => (
          <MenuItem key={person.id} selected={value === person.id} onClick={() => pick(person.id)}>
            <ListItemIcon>
              {value === person.id ? (
                <CheckRounded fontSize="small" />
              ) : (
                <Avatar name={person.name} color={person.color} photo={person.photo} size={24} />
              )}
            </ListItemIcon>
            <ListItemText>{person.name}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

/**
 * Completed (spec: PL-144): what got done and when. A heatmap of done tasks per day over as long
 * as completed tasks stay, the totals for today, this week, this month and the days in a row, then
 * every closed task by the day it closed (each time of a repeating task on its own), which open as
 * anywhere else, so they can be reopened or tidied here. A day on the heatmap shows that day only.
 * Narrowed by list or tag, and by who completed them on shared lists. Won't do is listed but not
 * counted; tasks in the Trash count but are not listed.
 */
export function CompletedView() {
  const full = useWorkspace();
  const { workspace, button } = useNarrowed('completed');
  const today = useToday();
  const zone = localTimeZone();
  const me = useStoreState((state) => state.context().userId);
  const [by, setBy] = useState<Id | null>(null);
  const [day, setDay] = useState<string | null>(null);

  const counts = useMemo(
    () => doneByDay(workspace.entities.tasks, zone, by),
    [workspace, zone, by],
  );
  const totals = doneTotals(counts, today, weekStart());
  const all = useMemo(
    () => completedTasks(workspace).filter((task) => !by || task.completedBy === by),
    [workspace, by],
  );
  const tasks = day ? all.filter((task) => closedDay(task, zone) === day) : all;
  // Done that day but in the Trash: counted on the heatmap, so say where they are.
  const inTrash = day
    ? workspace.entities.tasks.filter(
        (task) =>
          countsAsDone(task) &&
          task.deletedAt !== null &&
          (!by || task.completedBy === by) &&
          localDayOf(task.completedAt!, zone) === day,
      ).length
    : 0;

  const people = useMemo(() => {
    const ids = new Set<Id>();
    for (const task of completedTasks(full)) if (task.completedBy) ids.add(task.completedBy);
    if (ids.size < 2 && (ids.size === 0 || ids.has(me))) return [];
    return [...ids]
      .map((id) => {
        const who = describePrincipal(full, `user:${id}`);
        return { id, name: who.name, color: who.color, photo: who.user?.photo ?? null };
      })
      .sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : a.name.localeCompare(b.name)));
  }, [full, me]);

  // Drawn as they scroll near, the whole list's height kept from the start (R-FB-94).
  const { shown, spacer } = useReveal(tasks.length);
  const groups: { key: string; title: string; total: number; rows: typeof tasks }[] = [];
  let left = shown;
  for (const group of groupClosed(tasks, today, zone)) {
    if (left <= 0) break;
    const rows = group.tasks.slice(0, left);
    left -= rows.length;
    groups.push({ key: group.key, title: group.title, total: group.tasks.length, rows });
  }

  const empty = all.length === 0 && counts.size === 0;
  return (
    <Page
      title={t('nav.completed')}
      actions={
        <>
          {people.length > 0 && <CompletedByButton people={people} value={by} onChange={setBy} />}
          {button}
        </>
      }
    >
      {empty ? (
        <EmptyState title={t('completed.empty')} />
      ) : (
        <>
          <Stack spacing={1.5} sx={{ px: 1, pb: 2 }}>
            <CompletedHeatmap
              counts={counts}
              today={today}
              weeks={heatWeeks(full)}
              weekStart={weekStart()}
              selected={day}
              onSelect={setDay}
            />
            <Box
              role="group"
              aria-label={t('completed.totals')}
              sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 1 }}
            >
              <Total label={t('completed.today')} value={totals.today} />
              <Total label={t('completed.week')} value={totals.week} />
              <Total label={t('completed.month')} value={totals.month} />
              <Total label={t('completed.streak')} value={totals.streak} />
            </Box>
            <Typography variant="caption" color="text.secondary">
              {t('completed.kept', { period: purgePeriod(purgeDaysOf(full)) })}{' '}
              <Link component={RouterLink} to="/settings/data">
                {t('completed.keptLink')}
              </Link>
            </Typography>
          </Stack>
          {day && (
            <Stack
              direction="row"
              sx={{ alignItems: 'center', justifyContent: 'space-between', px: 1, pb: 1 }}
            >
              <Typography variant="subtitle2" component="h2">
                {t('completed.onDay', { day: formatDay(day, today) })}
              </Typography>
              <Button size="small" onClick={() => setDay(null)}>
                {t('completed.showAll')}
              </Button>
            </Stack>
          )}
          {day && tasks.length === 0 && (
            <Typography color="text.secondary" sx={{ px: 1, pb: 1 }}>
              {t('completed.nothingOnDay')}
            </Typography>
          )}
          {groups.map((group) => (
            <GroupSection
              key={group.key}
              groupKey={`closed:${group.key}`}
              title={group.title || t('group.noDate')}
              count={group.total}
            >
              <TaskRows tasks={group.rows} showList />
            </GroupSection>
          ))}
          {inTrash > 0 && (
            <Typography color="text.secondary" sx={{ px: 1, pt: 1 }}>
              {inTrash === 1
                ? t('completed.inTrashOne')
                : t('completed.inTrashMany', { count: inTrash })}
            </Typography>
          )}
          {spacer}
        </>
      )}
    </Page>
  );
}
