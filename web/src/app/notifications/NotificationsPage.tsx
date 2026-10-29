import AlternateEmailRounded from '@mui/icons-material/AlternateEmailRounded';
import BackHandOutlined from '@mui/icons-material/BackHandOutlined';
import ChatBubbleOutlineRounded from '@mui/icons-material/ChatBubbleOutlineRounded';
import GroupsOutlined from '@mui/icons-material/GroupsOutlined';
import CloseRounded from '@mui/icons-material/CloseRounded';
import NotificationsNoneRounded from '@mui/icons-material/NotificationsNoneRounded';
import { Box, Button, ButtonBase, IconButton, Tooltip, Typography } from '@mui/material';
import { useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { getEntity } from '../../core/collections.ts';
import { localDateTimeOf, localTimeZone } from '../../core/dates.ts';
import { addComment, canComment } from '../../core/comments.ts';
import { canClaim, claimTask } from '../../core/sharing.ts';
import { formatWhen } from '../format.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { AssignedIcon, ShareIcon } from '../icons/icons.tsx';
import { Page } from '../layout/Page.tsx';
import { useApply, useStoreState, useWorkspace } from '../store/hooks.ts';
import { useSyncState } from '../sync/syncContext.ts';
import { THUMBS_UP } from './NotificationLinks.tsx';
import { notificationSentence } from './notificationText.ts';
import { useTaskSelection } from '../tasks/selection.ts';
import { EmptyState } from '../views/EmptyState.tsx';
import { useNotifications, type NotificationItem } from './notificationsContext.ts';

const ICONS: Record<NotificationItem['kind'], ReactNode> = {
  assigned: <AssignedIcon fontSize="small" />,
  groupAssigned: <GroupsOutlined fontSize="small" />,
  claimed: <BackHandOutlined fontSize="small" />,
  shared: <ShareIcon fontSize="small" />,
  mentioned: <AlternateEmailRounded fontSize="small" />,
  commented: <ChatBubbleOutlineRounded fontSize="small" />,
  commentEdited: <ChatBubbleOutlineRounded fontSize="small" />,
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
  const apply = useApply();
  const me = useStoreState((state) => state.context().userId);
  const syncNow = useSyncState((state) => state.syncNow);

  // Seen once the page shows them (after a moment, so they show as new first).
  useEffect(() => {
    if (unread === 0) return;
    const timer = setTimeout(() => read(null), 1500);
    return () => clearTimeout(timer);
  }, [unread, read]);

  const sentence = (item: NotificationItem): string => notificationSentence(workspace, item);
  const go = (item: NotificationItem) => {
    if (!item.read) read([item.id]);
    if (item.taskId && getEntity(workspace, 'tasks', item.taskId)) {
      // A comment's: its comments open, scrolled to it (R-FB-106).
      open(item.taskId, item.commentId ? { comment: item.commentId } : undefined);
    } else if (item.listId) void navigate(`/lists/${item.listId}`);
  };

  // Buttons under a notification, left and right (R-FB-106, R-FB-107).
  const buttons = (item: NotificationItem) => {
    const task = item.taskId ? getEntity(workspace, 'tasks', item.taskId) : undefined;
    if (!task) return null;
    const about =
      item.kind === 'commented' || item.kind === 'commentEdited' || item.kind === 'mentioned';
    if (about && item.commentId && canComment(workspace, me, task)) {
      return [
        <Button key="reply" size="small" onClick={() => go(item)}>
          {t('notifications.reply')}
        </Button>,
        <Button
          key="like"
          size="small"
          aria-label={t('notifications.like')}
          onClick={() => {
            if (!item.read) read([item.id]);
            apply(
              (ctx, ws) => addComment(ctx, ws, task.id, THUMBS_UP).workspace,
              t('notifications.liked'),
            );
            void syncNow();
          }}
        >
          {THUMBS_UP}
        </Button>,
      ];
    }
    if (item.kind === 'groupAssigned') {
      return [
        <Button key="open" size="small" onClick={() => go(item)}>
          {t('notifications.openTask')}
        </Button>,
        canClaim(workspace, me, task) ? (
          <Button
            key="dibs"
            size="small"
            onClick={() => {
              if (!item.read) read([item.id]);
              apply((ctx, ws) => claimTask(ctx, ws, task.id), t('notifications.calledDibs'));
              void syncNow();
            }}
          >
            {t('assignee.dibs')}
          </Button>
        ) : (
          <span key="dibs" />
        ),
      ];
    }
    return null;
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
            const actions = buttons(item);
            return (
              <Box
                component="li"
                key={item.id}
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
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
                {actions && (
                  <Box
                    sx={{
                      flexBasis: '100%',
                      display: 'flex',
                      justifyContent: 'space-between',
                      pl: 5,
                      pr: 1,
                      pb: 0.75,
                      mt: -0.75,
                    }}
                  >
                    {actions}
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      )}
    </Page>
  );
}
