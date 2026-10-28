import AddRounded from '@mui/icons-material/AddRounded';
import BlockRounded from '@mui/icons-material/BlockRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import DonutLargeRounded from '@mui/icons-material/DonutLargeRounded';
import DriveFileMoveOutlined from '@mui/icons-material/DriveFileMoveOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import HistoryRounded from '@mui/icons-material/HistoryRounded';
import NotesRounded from '@mui/icons-material/NotesRounded';
import NotificationsNoneRounded from '@mui/icons-material/NotificationsNoneRounded';
import RadioButtonUncheckedRounded from '@mui/icons-material/RadioButtonUncheckedRounded';
import RepeatRounded from '@mui/icons-material/RepeatRounded';
import RestoreFromTrashOutlined from '@mui/icons-material/RestoreFromTrashOutlined';
import SubdirectoryArrowRightRounded from '@mui/icons-material/SubdirectoryArrowRightRounded';
import TagRounded from '@mui/icons-material/TagRounded';
import { Box, Typography } from '@mui/material';
import { useEffect, useState, type ReactElement } from 'react';
import { localDateTimeOf, localTimeZone } from '../../core/dates.ts';
import { describePrincipal } from '../../core/sharing.ts';
import type { Task } from '../../core/types.ts';
import type { HistoryEntry } from '../../ports/sync.ts';
import { formatWhen } from '../format.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { useStoreState, useWorkspace } from '../store/hooks.ts';
import { useSyncState } from '../sync/syncContext.ts';
import { historyText } from './historyText.ts';
import { AssignedIcon, CalendarIcon, DueIcon, FlagIcon, PinIcon } from '../icons/icons.tsx';

/** What changed, at a glance: an icon per kind of change, as TickTick's activity does. */
function iconFor(entry: HistoryEntry): ReactElement {
  const done = entry.after === '"done"';
  const dropped = entry.after === '"wontdo"';
  switch (entry.field) {
    case 'created':
      return <AddRounded />;
    case 'deleted':
      return <DeleteOutlineRounded />;
    case 'restored':
      return <RestoreFromTrashOutlined />;
    case 'title':
      return <EditOutlined />;
    case 'status':
      return done ? <CheckRounded /> : dropped ? <BlockRounded /> : <RadioButtonUncheckedRounded />;
    case 'schedule':
      return <CalendarIcon />;
    case 'due':
      return <DueIcon />;
    case 'priority':
      return <FlagIcon />;
    case 'listId':
      return <DriveFileMoveOutlined />;
    case 'parentId':
      return <SubdirectoryArrowRightRounded />;
    case 'assignees':
      return <AssignedIcon />;
    case 'tags':
      return <TagRounded />;
    case 'notes':
      return <NotesRounded />;
    case 'recurrence':
      return <RepeatRounded />;
    case 'reminders':
      return <NotificationsNoneRounded />;
    case 'progress':
      return <DonutLargeRounded />;
    case 'pinnedAt':
      return <PinIcon />;
    default:
      return <HistoryRounded />;
  }
}

/** The circle an icon sits in on the timeline. */
const DOT = 26;

/**
 * A task's history (R-FB-105), TickTick style: who did what and when, newest first, under the
 * comments. The server keeps it, so it is fetched when shown and again after each sync.
 */
export function TaskHistory({ task }: { task: Task }) {
  const workspace = useWorkspace();
  const today = useToday();
  const me = useStoreState((state) => state.context().userId);
  const api = useSyncState((state) => state.transport.history);
  const ready = useSyncState((state) => state.phase === 'ready');
  const synced = useSyncState((state) => state.lastSynced);
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!api || !ready) return;
    let current = true;
    api.task(task.id).then(
      (found) => {
        if (!current) return;
        setEntries(found);
        setFailed(false);
      },
      () => {
        if (current) setFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, [api, ready, synced, task.id]);

  const zone = localTimeZone();
  const note = (text: string) => (
    <Typography variant="body2" color="text.disabled">
      {text}
    </Typography>
  );
  return (
    <Box component="section" aria-label={t('history.title')}>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
        {t('history.title')}
      </Typography>
      {!api ? (
        note(t('history.standalone'))
      ) : entries === null ? (
        failed && note(t('history.offline'))
      ) : entries.length === 0 ? (
        note(t('history.empty'))
      ) : (
        // A timeline: each change's icon in a circle on a line running down the left.
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, pl: 0.5 }}>
          {entries.map((entry) => {
            const actor =
              entry.actorId === me
                ? t('history.you')
                : entry.actorId
                  ? describePrincipal(workspace, `user:${entry.actorId}`).name
                  : t('history.someone');
            const when = formatWhen(localDateTimeOf(entry.at, zone), today);
            return (
              <Box
                component="li"
                key={entry.id}
                sx={{
                  position: 'relative',
                  display: 'flex',
                  gap: 1.5,
                  pb: 1.5,
                  // The line to the next change.
                  '&:not(:last-of-type)::before': {
                    content: '""',
                    position: 'absolute',
                    left: DOT / 2 - 1,
                    top: DOT,
                    bottom: 0,
                    width: 2,
                    bgcolor: 'divider',
                  },
                }}
              >
                <Box
                  aria-hidden
                  sx={{
                    width: DOT,
                    height: DOT,
                    flexShrink: 0,
                    borderRadius: '50%',
                    border: 1,
                    borderColor: 'divider',
                    bgcolor: 'background.paper',
                    color: 'text.secondary',
                    display: 'grid',
                    placeItems: 'center',
                    '& svg': { fontSize: 15 },
                  }}
                >
                  {iconFor(entry)}
                </Box>
                <Box sx={{ minWidth: 0, pt: 0.25 }}>
                  <Typography variant="body2">
                    {t('history.line', { actor, change: historyText(entry, workspace, today) })}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {when}
                  </Typography>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
