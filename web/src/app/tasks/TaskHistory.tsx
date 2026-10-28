import { Box, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
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
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {entries.map((entry) => {
            const actor =
              entry.actorId === me
                ? t('history.you')
                : entry.actorId
                  ? describePrincipal(workspace, `user:${entry.actorId}`).name
                  : t('history.someone');
            const when = formatWhen(localDateTimeOf(entry.at, zone), today);
            return (
              <Box component="li" key={entry.id} sx={{ py: 0.5 }}>
                <Typography variant="body2">
                  {t('history.line', { actor, change: historyText(entry, workspace, today) })}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {when}
                </Typography>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
