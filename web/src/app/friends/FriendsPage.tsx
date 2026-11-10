import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  List,
  ListItem,
  ListItemText,
  Snackbar,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  acceptFriendship,
  endFriendship,
  friendsOf,
  mySharesWith,
  nameOf,
  sendFriendRequest,
  unfriend,
  type Friend,
} from '../../core/sharing.ts';
import type { ProfilePreview } from '../../ports/sync.ts';
import { copyOrSelect } from '../copy.ts';
import { CopyByHand } from '../CopyByHand.tsx';
import { t } from '../i18n/i18n.ts';
import { CopyIcon, QrIcon } from '../icons/icons.tsx';
import { Page } from '../layout/Page.tsx';
import { ConfirmDialog } from '../lists/ListDialog.tsx';
import { useApply, useStoreState, useWorkspace } from '../store/hooks.ts';
import { useSyncState } from '../sync/syncContext.ts';
import { Avatar } from './Avatar.tsx';
import { Groups } from './Groups.tsx';
import { QrCode } from './QrCode.tsx';
import { WhatYouShare } from './WhatYouShare.tsx';

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
        <WhatYouShare />
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

/**
 * The link to share. A server with no address to make it from (no PUBLIC_URL on a public name)
 * sends the code alone: the link is then made from this page's own address, which the person
 * reached the server by. The app is served from the server, at its root.
 */
function linkOf(code: { code: string; link: string | null }): string {
  return code.link ?? `${window.location.origin}/f/${encodeURIComponent(code.code)}`;
}

function YourLink() {
  const friends = useSyncState((state) => state.transport.friends)!;
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [byHand, setByHand] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const [showQr, setShowQr] = useState(false);
  useEffect(() => {
    let live = true;
    void friends
      .code()
      .then((code) => live && setLink(linkOf(code)))
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
          inputRef={field}
          slotProps={{ htmlInput: { readOnly: true, 'aria-label': t('friends.yourLink') } }}
          onFocus={(event) => event.target.select()}
          sx={{ flexGrow: 1, minWidth: 240 }}
        />
        <Button
          variant="outlined"
          startIcon={<CopyIcon />}
          disabled={!link}
          onClick={(event) => {
            if (!link) return;
            void copyOrSelect(link, field.current, event.currentTarget).then((result) =>
              result === 'copied' ? setCopied(true) : setByHand(true),
            );
          }}
        >
          {t('friends.copy')}
        </Button>
        <Button
          variant="outlined"
          startIcon={<QrIcon />}
          disabled={!link}
          onClick={() => setShowQr(true)}
        >
          {t('friends.qr')}
        </Button>
        <Button onClick={() => void friends.code(true).then((code) => setLink(linkOf(code)))}>
          {t('friends.newLink')}
        </Button>
      </Box>
      <Typography variant="caption" color="text.secondary">
        {t('friends.linkHint')}
      </Typography>
      {link && (
        <Dialog open={showQr} onClose={() => setShowQr(false)}>
          <DialogTitle>{t('friends.yourLink')}</DialogTitle>
          <DialogContent sx={{ display: 'grid', justifyItems: 'center', gap: 2 }}>
            <QrCode text={link} label={t('friends.qrOf', { link })} />
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
              {t('friends.qrHint')}
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setShowQr(false)}>{t('common.done')}</Button>
          </DialogActions>
        </Dialog>
      )}
      <Snackbar
        open={copied}
        autoHideDuration={2000}
        onClose={() => setCopied(false)}
        message={t('friends.copied')}
      />
      <CopyByHand open={byHand} onClose={() => setByHand(false)} />
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
        <Avatar
          name={name}
          color={friend.user?.avatarColor ?? '#B8BCC4'}
          photo={friend.user?.photo}
        />
      </Box>
      <ListItemText
        primary={name}
        secondary={[
          friend.user?.handle,
          friend.friendship.madeBy && t('friends.madeBy', { name: friend.friendship.madeBy.name }),
        ]
          .filter(Boolean)
          .join(' · ')}
      />
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

/**
 * Stop being friends, and by default take back what they reach through me (spec: Unfriending). The
 * choice shows only when there is something of mine to take back: lists they own, or that I only
 * joined, are not mine to change.
 */
function UnfriendDialog({ friend, onClose }: { friend: Friend; onClose: () => void }) {
  const apply = useApply();
  const workspace = useWorkspace();
  const me = useStoreState((state) => state.context().userId);
  const [removeShares, setRemoveShares] = useState(true);
  const name = nameOf(friend.user, friend.userId);
  const shares = mySharesWith(workspace, me, friend.userId);
  const anyShares = shares.members.length + shares.tasks.length > 0;
  return (
    <ConfirmDialog
      open
      message={t('friends.unfriendConfirm', { name })}
      confirmLabel={t('friends.unfriend')}
      onClose={onClose}
      onConfirm={() => {
        apply((ctx, ws) => unfriend(ctx, ws, friend, anyShares && removeShares));
        onClose();
      }}
    >
      {anyShares && (
        <>
          <FormControlLabel
            sx={{ mt: 1.5 }}
            control={
              <Checkbox
                checked={removeShares}
                onChange={(event) => setRemoveShares(event.target.checked)}
              />
            }
            label={t('friends.unfriendShares', { name })}
          />
          <Typography variant="caption" color="text.secondary" component="div">
            {t('friends.unfriendSharesHint')}
          </Typography>
        </>
      )}
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1.5 }}>
        {t('friends.unfriendLinkHint')}
      </Typography>
    </ConfirmDialog>
  );
}

function YourFriends() {
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
      {ending && <UnfriendDialog friend={ending} onClose={() => setEnding(null)} />}
    </Section>
  );
}
