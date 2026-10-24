import AlternateEmailRounded from '@mui/icons-material/AlternateEmailRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import NotificationsNoneRounded from '@mui/icons-material/NotificationsNoneRounded';
import { Box, Button, ButtonBase, IconButton, Tooltip, Typography } from '@mui/material';
import { useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { getEntity } from '../../core/collections.ts';
import { localDateTimeOf, localTimeZone } from '../../core/dates.ts';
import { describePrincipal } from '../../core/sharing.ts';
import { formatWhen } from '../format.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { AssignedIcon, ShareIcon } from '../icons/icons.tsx';
import { Page } from '../layout/Page.tsx';
import { listName } from '../lists/listName.ts';
import { useWorkspace } from '../store/hooks.ts';
import { useTaskSelection } from '../tasks/selection.ts';
import { EmptyState } from '../views/EmptyState.tsx';
import { useNotifications, type NotificationItem } from './notificationsContext.ts';

const ICONS: Record<NotificationItem['kind'], ReactNode> = {
  assigned: <AssignedIcon fontSize="small" />,
  shared: <ShareIcon fontSize="small" />,
  mentioned: <AlternateEmailRounded fontSize="small" />,
  reminder: <NotificationsNoneRounded fontSize="small" />,
};

/**
 * Notifications (spec: PL-061): reminders, @mentions, assignments and shares in one list, newest
 * first. A click opens the task or list; the cross clears one, Clear all clears them all. Opening
 * the page marks them read.
 */
export function NotificationsPage() {
  const workspace = useWorkspace();
  const today = useToday();
  const navigate = useNavigate();
  const { open } = useTaskSelection();
  const { items, unread, read, clear } = useNotifications();
  const zone = localTimeZone();

  // Seen once the page shows them (after a moment, so they show as new first).
  useEffect(() => {
    if (unread === 0) return;
    const timer = setTimeout(() => read(null), 1500);
    return () => clearTimeout(timer);
  }, [unread, read]);

  const sentence = (item: NotificationItem): string => {
    const actor = item.actorId ? describePrincipal(workspace, `user:${item.actorId}`).name : '';
    const task = item.taskId ? getEntity(workspace, 'tasks', item.taskId) : undefined;
    const list = item.listId ? getEntity(workspace, 'lists', item.listId) : undefined;
    const taskName = task ? task.title || t('task.untitled') : t('notifications.aTask');
    const listLabel = list ? listName(list, workspace) : t('notifications.aList');
    switch (item.kind) {
      case 'assigned':
        return t('notifications.assigned', { actor, task: taskName });
      case 'shared':
        return t('notifications.shared', { actor, list: listLabel });
      case 'mentioned':
        return t('notifications.mentioned', { actor, task: taskName });
      case 'reminder':
        return t('notifications.reminder', { task: taskName });
    }
  };
  const go = (item: NotificationItem) => {
    if (!item.read) read([item.id]);
    if (item.taskId && getEntity(workspace, 'tasks', item.taskId)) open(item.taskId);
    else if (item.listId) void navigate(`/lists/${item.listId}`);
  };

  return (
    <Page
      title={t('notifications.title')}
      actions={
        items.length > 0 && (
          <Button size="small" onClick={() => clear(null)}>
            {t('notifications.clearAll')}
          </Button>
        )
      }
    >
      {items.length === 0 ? (
        <EmptyState title={t('notifications.empty')} hint={t('notifications.emptyHint')} />
      ) : (
        <Box
          component="ul"
          aria-label={t('notifications.title')}
          sx={{ listStyle: 'none', m: 0, p: 0 }}
        >
          {items.map((item) => {
            const text = sentence(item);
            const when = formatWhen(localDateTimeOf(new Date(item.at).toISOString(), zone), today);
            return (
              <Box
                component="li"
                key={item.id}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  borderBottom: 1,
                  borderColor: 'divider',
                }}
              >
                <ButtonBase
                  onClick={() => go(item)}
                  aria-label={item.read ? text : t('notifications.unreadItem', { text })}
                  sx={{
                    flexGrow: 1,
                    minWidth: 0,
                    justifyContent: 'flex-start',
                    gap: 1.5,
                    px: 1,
                    py: 1.25,
                    textAlign: 'left',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <Box
                    sx={{ display: 'flex', color: item.read ? 'text.secondary' : 'primary.main' }}
                  >
                    {ICONS[item.kind]}
                  </Box>
                  <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                    <Typography
                      sx={{ fontWeight: item.read ? 400 : 600, overflowWrap: 'anywhere' }}
                    >
                      {text}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {when}
                    </Typography>
                  </Box>
                  {!item.read && (
                    <Box
                      aria-hidden
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        bgcolor: 'primary.main',
                        flexShrink: 0,
                      }}
                    />
                  )}
                </ButtonBase>
                <Tooltip title={t('notifications.clear')}>
                  <IconButton
                    size="small"
                    aria-label={t('notifications.clearOne', { text })}
                    onClick={() => clear([item.id])}
                  >
                    <CloseRounded fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            );
          })}
        </Box>
      )}
    </Page>
  );
}
