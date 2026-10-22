import {
  Alert,
  Box,
  Button,
  Divider,
  List,
  ListItem,
  ListItemText,
  Snackbar,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState, type FormEvent } from 'react';
import {
  acceptFriendship,
  endFriendship,
  friendsOf,
  nameOf,
  sendFriendRequest,
  type Friend,
} from '../../core/sharing.ts';
import type { ProfilePreview } from '../../ports/sync.ts';
import { t } from '../i18n/i18n.ts';
import { CopyIcon } from '../icons/icons.tsx';
import { Page } from '../layout/Page.tsx';
import { ConfirmDialog } from '../lists/ListDialog.tsx';
import { useApply, useStoreState, useWorkspace } from '../store/hooks.ts';
import { useSyncState } from '../sync/syncContext.ts';
import { Avatar } from './Avatar.tsx';
import { Groups } from './Groups.tsx';

/**
 * Friends (spec: Sharing & Permissions): your friend link to share, adding someone by exact
 * username, open requests, and your friends.
 */
export function FriendsPage() {
  const phase = useSyncState((state) => state.phase);
  const friendsApi = useSyncState((state) => state.transport.friends);
  if (phase !== 'ready' || !friendsApi) {
    return (
      <Page title={t('friends.title')}>
        <Typography color="text.secondary">{t('friends.needsServer')}</Typography>
      </Page>
    );
  }
  return (
    <Page title={t('friends.title')}>
      <Box sx={{ maxWidth: 640, display: 'grid', gap: 4 }}>
        <YourLink />
        <AddFriend />
        <Requests />
        <YourFriends />
        <Groups title={t('group.title')} />
      </Box>
    </Page>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box component="section" aria-label={title}>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

function YourLink() {
  const friends = useSyncState((state) => state.transport.friends)!;
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    void friends
      .code()
      .then((code) => live && setLink(code.link))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [friends]);

  return (
    <Section title={t('friends.yourLink')}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <TextField
          size="small"
          value={link ?? ''}
          slotProps={{ htmlInput: { readOnly: true, 'aria-label': t('friends.yourLink') } }}
          onFocus={(event) => event.target.select()}
          sx={{ flexGrow: 1, minWidth: 240 }}
        />
        <Button
          variant="outlined"
          startIcon={<CopyIcon />}
          disabled={!link}
          onClick={() => {
            if (!link) return;
            void navigator.clipboard?.writeText(link).then(() => setCopied(true));
          }}
        >
          {t('friends.copy')}
        </Button>
        <Button onClick={() => void friends.code(true).then((code) => setLink(code.link))}>
          {t('friends.newLink')}
        </Button>
      </Box>
      <Typography variant="caption" color="text.secondary">
        {t('friends.linkHint')}
      </Typography>
      <Snackbar
        open={copied}
        autoHideDuration={2000}
        onClose={() => setCopied(false)}
        message={t('friends.copied')}
      />
    </Section>
  );
}

function AddFriend() {
  const friends = useSyncState((state) => state.transport.friends)!;
  const syncNow = useSyncState((state) => state.syncNow);
  const apply = useApply();
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<ProfilePreview | null | undefined>(undefined);
  const [asked, setAsked] = useState(false);

  const find = async (event: FormEvent) => {
    event.preventDefault();
    setAsked(false);
    setFound(await friends.lookup(query.trim()));
  };

  return (
    <Section title={t('friends.add')}>
      <Box component="form" onSubmit={(event) => void find(event)} sx={{ display: 'flex', gap: 1 }}>
        <TextField
          size="small"
          label={t('friends.addHint')}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setFound(undefined);
          }}
          slotProps={{ htmlInput: { autoCapitalize: 'none', spellCheck: false } }}
          sx={{ flexGrow: 1 }}
        />
        <Button type="submit" variant="outlined" disabled={query.trim() === ''}>
          {t('friends.find')}
        </Button>
      </Box>
      {found === null && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t('friends.notFound')}
        </Typography>
      )}
      {found && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1.5 }}>
          <Avatar name={found.displayName} color={found.avatarColor} />
          <ListItemText primary={found.displayName} secondary={found.handle} />
          {found.self ? (
            <Typography variant="body2" color="text.secondary">
              {t('friends.thatsYou')}
            </Typography>
          ) : found.friendship === 'accepted' ? (
            <Typography variant="body2" color="text.secondary">
              {t('friends.alreadyFriends')}
            </Typography>
          ) : asked || found.friendship === 'pending' ? (
            <Typography variant="body2" color="text.secondary">
              {t('friends.asked')}
            </Typography>
          ) : (
            <Button
              variant="contained"
              disableElevation
              onClick={() => {
                apply((ctx, ws) => sendFriendRequest(ctx, ws, found.userId));
                setAsked(true);
                void syncNow();
              }}
            >
              {t('friends.ask')}
            </Button>
          )}
        </Box>
      )}
    </Section>
  );
}

function useFriends(): Friend[] {
  const workspace = useWorkspace();
  const me = useStoreState((state) => state.context().userId);
  return friendsOf(workspace, me);
}

function Person({ friend, children }: { friend: Friend; children: React.ReactNode }) {
  const name = nameOf(friend.user, friend.userId);
  return (
    <ListItem
      disableGutters
      secondaryAction={<Box sx={{ display: 'flex', gap: 1 }}>{children}</Box>}
    >
      <Box sx={{ mr: 1.5 }}>
        <Avatar name={name} color={friend.user?.avatarColor ?? '#B8BCC4'} />
      </Box>
      <ListItemText primary={name} secondary={friend.user?.handle} />
    </ListItem>
  );
}

function Requests() {
  const apply = useApply();
  const requests = useFriends().filter((friend) => friend.state !== 'accepted');
  if (requests.length === 0) return null;
  return (
    <Section title={t('friends.requests')}>
      <List dense disablePadding>
        {requests.map((friend) => (
          <Person key={friend.friendship.id} friend={friend}>
            {friend.state === 'incoming' ? (
              <>
                <Button
                  size="small"
                  onClick={() => apply((ctx, ws) => endFriendship(ctx, ws, friend.friendship.id))}
                >
                  {t('friends.decline')}
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  disableElevation
                  onClick={() =>
                    apply((ctx, ws) => acceptFriendship(ctx, ws, friend.friendship.id))
                  }
                >
                  {t('friends.accept')}
                </Button>
              </>
            ) : (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'center' }}>
                  {t('friends.waiting')}
                </Typography>
                <Button
                  size="small"
                  onClick={() => apply((ctx, ws) => endFriendship(ctx, ws, friend.friendship.id))}
                >
                  {t('friends.takeBack')}
                </Button>
              </>
            )}
          </Person>
        ))}
      </List>
    </Section>
  );
}

function YourFriends() {
  const apply = useApply();
  const friends = useFriends().filter((friend) => friend.state === 'accepted');
  const [ending, setEnding] = useState<Friend | null>(null);
  return (
    <Section title={t('friends.list')}>
      {friends.length === 0 ? (
        <Alert severity="info" variant="outlined">
          {t('friends.none')}
        </Alert>
      ) : (
        <List dense disablePadding>
          {friends.map((friend, index) => (
            <Box key={friend.friendship.id}>
              {index > 0 && <Divider component="li" />}
              <Person friend={friend}>
                <Button size="small" color="inherit" onClick={() => setEnding(friend)}>
                  {t('friends.unfriend')}
                </Button>
              </Person>
            </Box>
          ))}
        </List>
      )}
      {ending && (
        <ConfirmDialog
          open
          message={t('friends.unfriendConfirm', { name: nameOf(ending.user, ending.userId) })}
          confirmLabel={t('friends.unfriend')}
          onClose={() => setEnding(null)}
          onConfirm={() => {
            apply((ctx, ws) => endFriendship(ctx, ws, ending.friendship.id));
            setEnding(null);
          }}
        />
      )}
    </Section>
  );
}
