import {
  Alert,
  Box,
  Button,
  ButtonBase,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { getEntity } from '../../core/collections.ts';
import {
  GOOGLE_CONNECT_PATH,
  type CalendarAccountInfo,
  type CalendarLinkInfo,
  type CalendarMode,
  type CalendarsApi,
} from '../../ports/calendars.ts';
import { ConfirmDialog } from '../admin/AdminDialogs.tsx';
import { t } from '../i18n/i18n.ts';
import { MoreIcon, PlusIcon } from '../icons/icons.tsx';
import { ProblemAlert } from '../layout/ProblemAlert.tsx';
import { Section } from '../settings/settingsLayout.tsx';
import { useWorkspace } from '../store/hooks.ts';
import { accountTitle, connectOutcome, problemText } from './calendarText.ts';
import { CalendarRow } from './CalendarRow.tsx';
import { CalendarTagDialog } from './CalendarTagDialog.tsx';
import { ConnectCalDavDialog } from './ConnectCalDavDialog.tsx';
import { useCalendarsApi, useEventsStore } from './useCalendarEvents.ts';

type TagDialog =
  { kind: 'sync'; link: CalendarLinkInfo } | { kind: 'create'; account: CalendarAccountInfo };

/**
 * Settings > Calendars (spec: PL-134): the accounts connected, each calendar's use, and
 * connecting another. Only on servers with calendar sync on, for someone signed in.
 */
export function CalendarsSettings() {
  const api = useCalendarsApi();
  if (!api) return null;
  return <Calendars api={api} />;
}

function Calendars({ api }: { api: CalendarsApi }) {
  const workspace = useWorkspace();
  const events = useEventsStore();
  const [params, setParams] = useSearchParams();
  const [accounts, setAccounts] = useState<CalendarAccountInfo[] | null>(null);
  const [providers, setProviders] = useState<readonly string[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [connect, setConnect] = useState<{ again?: CalendarAccountInfo } | null>(null);
  const [connectMenu, setConnectMenu] = useState<HTMLElement | null>(null);
  const [tagDialog, setTagDialog] = useState<TagDialog | null>(null);
  const [confirm, setConfirm] = useState<CalendarAccountInfo | null>(null);
  const [rowProblems, setRowProblems] = useState<Record<string, string>>({});
  const [busyLinks, setBusyLinks] = useState<ReadonlySet<string>>(new Set());
  const [accountNotes, setAccountNotes] = useState<Record<string, string>>({});
  // What a Google sign-in came back with (`?calendar=cal_connected`, or why not), kept while the
  // address drops it, so a reload does not say it again.
  const [returned] = useState(() => params.get('calendar'));
  useEffect(() => {
    if (!params.has('calendar')) return;
    params.delete('calendar');
    setParams(params, { replace: true });
  }, [params, setParams]);
  const [outcomeShown, setOutcomeShown] = useState(true);
  const outcome = returned && outcomeShown ? connectOutcome(returned) : null;

  const reload = async () => {
    try {
      const found = await api.list();
      setAccounts(found.accounts);
      setProviders(found.providers);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  };

  useEffect(() => {
    let live = true;
    api.list().then(
      (found) => {
        if (!live) return;
        setAccounts(found.accounts);
        setProviders(found.providers);
      },
      () => {
        if (live) setLoadFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [api]);

  const tagName = (id: string) => getEntity(workspace, 'tags', id)?.name ?? null;

  const replaceLink = (link: CalendarLinkInfo) =>
    setAccounts(
      (now) =>
        now?.map((account) => ({
          ...account,
          calendars: account.calendars.map((each) => (each.id === link.id ? link : each)),
        })) ?? now,
    );

  const busy = (id: string, on: boolean) =>
    setBusyLinks((now) => {
      const next = new Set(now);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const rowProblem = (id: string, text: string | null) =>
    setRowProblems((now) => {
      const rest = Object.fromEntries(Object.entries(now).filter(([key]) => key !== id));
      return text ? { ...rest, [id]: text } : rest;
    });

  /** A note under an account ("Too many tries...") is done with once something there works. */
  const clearNoteFor = (linkId: string) => {
    const owner = accounts?.find((account) => account.calendars.some((each) => each.id === linkId));
    if (owner) setAccountNotes((now) => ({ ...now, [owner.id]: '' }));
  };

  /** A calendar's new use, as the server answered it; the views follow. */
  const changed = (before: CalendarLinkInfo, after: CalendarLinkInfo) => {
    replaceLink(after);
    rowProblem(after.id, null);
    clearNoteFor(after.id);
    if (before.mode === 'show' || after.mode === 'show') events?.forgetLinks(new Set([after.id]));
  };

  const setMode = async (link: CalendarLinkInfo, mode: CalendarMode) => {
    if (mode === 'sync') {
      setTagDialog({ kind: 'sync', link });
      return;
    }
    busy(link.id, true);
    try {
      const result = await api.setMode(link.id, { mode });
      if (result.ok) changed(link, result.value);
      else rowProblem(link.id, problemText(result.code));
    } catch {
      rowProblem(link.id, t('calendars.problem.offline'));
    } finally {
      busy(link.id, false);
    }
  };

  const syncAccount = async (account: CalendarAccountInfo) => {
    setAccountNotes((now) => ({ ...now, [account.id]: '' }));
    for (const link of account.calendars.filter((each) => each.mode !== 'off')) {
      busy(link.id, true);
      try {
        const result = await api.syncNow(link.id);
        if (result.ok) {
          replaceLink(result.value);
        } else if (result.code === 'too_many') {
          // The server takes a few a minute from each person: the rest wait.
          setAccountNotes((now) => ({ ...now, [account.id]: t('calendars.problem.tooMany') }));
          break;
        } else {
          rowProblem(link.id, problemText(result.code));
        }
      } catch {
        setAccountNotes((now) => ({ ...now, [account.id]: t('calendars.problem.offline') }));
        break;
      } finally {
        busy(link.id, false);
      }
    }
    void events?.refresh();
  };

  const disconnect = async (account: CalendarAccountInfo) => {
    try {
      await api.disconnect(account.id);
      setAccounts((now) => now?.filter((each) => each.id !== account.id) ?? now);
      events?.forgetLinks(new Set(account.calendars.map((each) => each.id)));
    } catch {
      setAccountNotes((now) => ({ ...now, [account.id]: t('calendars.problem.offline') }));
    }
  };

  /**
   * A CalDAV account connected again with a new password: its calendars keep their use (matched
   * by name), then the old connection goes. Synced tasks pair up again with their events.
   */
  const reconnected = async (previous: CalendarAccountInfo, fresh: CalendarAccountInfo) => {
    for (const old of previous.calendars.filter((each) => each.mode !== 'off')) {
      const match = fresh.calendars.find((each) => each.name === old.name);
      if (!match) continue;
      await api
        .setMode(match.id, {
          mode: old.mode,
          ...(old.tagId ? { tagId: old.tagId } : {}),
          ...(old.listId ? { listId: old.listId } : {}),
        })
        .catch(() => undefined);
    }
    await api.disconnect(previous.id).catch(() => undefined);
    await reload();
    void events?.refresh();
  };

  const google = providers.includes('google');

  return (
    <Stack spacing={4}>
      <Section title={t('calendars.title')} hint={t('calendars.intro')}>
        {outcome && (
          <Alert
            severity={outcome.ok ? 'success' : 'error'}
            variant="outlined"
            onClose={() => setOutcomeShown(false)}
            sx={{ mb: 1 }}
          >
            {outcome.text}
          </Alert>
        )}
        <ProblemAlert problem={loadFailed ? t('calendars.loadFailed') : null} />
        {accounts?.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
            {t('calendars.none')}
          </Typography>
        )}
        <Box sx={{ pt: 1 }}>
          <Button
            variant="outlined"
            startIcon={<PlusIcon />}
            disabled={accounts === null}
            aria-haspopup={google ? 'menu' : 'dialog'}
            onClick={(click) => (google ? setConnectMenu(click.currentTarget) : setConnect({}))}
          >
            {t('calendars.connectButton')}
          </Button>
          <Menu
            anchorEl={connectMenu}
            open={connectMenu !== null}
            onClose={() => setConnectMenu(null)}
          >
            {/* A link the whole page follows to the server's sign-in: in a browser it runs in this
                tab; the Android app opens it in a browser tab of its own, since Google refuses
                WebViews, and comes back to Settings. */}
            <MenuItem component="a" href={GOOGLE_CONNECT_PATH}>
              {t('calendars.connect.google')}
            </MenuItem>
            <MenuItem
              onClick={() => {
                setConnectMenu(null);
                setConnect({});
              }}
            >
              {t('calendars.connect.caldav')}
            </MenuItem>
          </Menu>
        </Box>
      </Section>
      {accounts?.map((account) => (
        <AccountCard
          key={account.id}
          account={account}
          tagName={tagName}
          busyLinks={busyLinks}
          rowProblems={rowProblems}
          note={accountNotes[account.id] ?? null}
          onMode={(link, mode) => void setMode(link, mode)}
          onSync={() => void syncAccount(account)}
          onDisconnect={() => setConfirm(account)}
          onReconnect={() => setConnect({ again: account })}
          onCreate={() => setTagDialog({ kind: 'create', account })}
        />
      ))}
      {connect && (
        <ConnectCalDavDialog
          api={api}
          {...(connect.again
            ? {
                again: {
                  serverUrl: connect.again.serverUrl,
                  username: connect.again.username ?? '',
                },
              }
            : {})}
          onConnected={(fresh) => {
            const previous = connect.again;
            if (previous) void reconnected(previous, fresh);
            else setAccounts((now) => [...(now ?? []), fresh]);
          }}
          onClose={() => setConnect(null)}
        />
      )}
      {tagDialog?.kind === 'sync' && (
        <CalendarTagDialog
          title={t('calendars.tag.syncTitle', { calendar: tagDialog.link.name })}
          text={t('calendars.tag.syncText')}
          action={t('calendars.tag.syncAction')}
          initialTag={tagDialog.link.tagId}
          initialList={tagDialog.link.listId}
          run={async ({ tagId, listId }) => {
            const link = tagDialog.link;
            const result = await api.setMode(link.id, {
              mode: 'sync',
              tagId,
              ...(listId ? { listId } : {}),
            });
            if (result.ok) changed(link, result.value);
            return result;
          }}
          onClose={() => setTagDialog(null)}
        />
      )}
      {tagDialog?.kind === 'create' && (
        <CalendarTagDialog
          title={t('calendars.tag.createTitle')}
          text={t('calendars.tag.createText')}
          action={t('calendars.tag.createAction')}
          name="PeckList"
          run={async ({ name, tagId, listId }) => {
            const account = tagDialog.account;
            const result = await api.createCalendar(account.id, {
              name,
              tagId,
              ...(listId ? { listId } : {}),
            });
            if (result.ok) {
              const made = result.value;
              setAccounts(
                (now) =>
                  now?.map((each) =>
                    each.id === account.id
                      ? { ...each, calendars: [...each.calendars, made] }
                      : each,
                  ) ?? now,
              );
            }
            return result;
          }}
          onClose={() => setTagDialog(null)}
        />
      )}
      <ConfirmDialog
        confirm={
          confirm && {
            title: t('calendars.disconnect.title', { name: accountTitle(confirm) }),
            // Disconnecting revokes PeckList's grant at Google for that address, so its other
            // connections (another server, someone else here) need a reconnect (Security N3).
            text: t(
              confirm.provider === 'google'
                ? 'calendars.disconnect.textGoogle'
                : 'calendars.disconnect.text',
            ),
            action: t('calendars.disconnect.action'),
            run: () => void disconnect(confirm),
          }
        }
        onClose={() => setConfirm(null)}
      />
    </Stack>
  );
}

function AccountCard({
  account,
  tagName,
  busyLinks,
  rowProblems,
  note,
  onMode,
  onSync,
  onDisconnect,
  onReconnect,
  onCreate,
}: {
  account: CalendarAccountInfo;
  tagName: (id: string) => string | null;
  busyLinks: ReadonlySet<string>;
  rowProblems: Readonly<Record<string, string>>;
  note: string | null;
  onMode: (link: CalendarLinkInfo, mode: CalendarMode) => void;
  onSync: () => void;
  onDisconnect: () => void;
  onReconnect: () => void;
  onCreate: () => void;
}) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const title = accountTitle(account);
  const anyOn = account.calendars.some((each) => each.mode !== 'off');
  const syncing = account.calendars.some((each) => busyLinks.has(each.id));
  return (
    <Section
      title={title}
      // A Google account goes by its address; a CalDAV one by its username.
      hint={account.username ?? account.name}
      action={
        <>
          <IconButton
            size="small"
            aria-label={t('calendars.account.actions', { name: title })}
            aria-haspopup="menu"
            onClick={(click) => setMenu(click.currentTarget)}
          >
            <MoreIcon fontSize="small" />
          </IconButton>
          <Menu anchorEl={menu} open={menu !== null} onClose={() => setMenu(null)}>
            <MenuItem
              disabled={!anyOn || syncing || account.status === 'auth_failed'}
              onClick={() => {
                setMenu(null);
                onSync();
              }}
            >
              {t('calendars.account.syncNow')}
            </MenuItem>
            <MenuItem
              onClick={() => {
                setMenu(null);
                onDisconnect();
              }}
            >
              {t('calendars.account.disconnect')}
            </MenuItem>
          </Menu>
        </>
      }
    >
      {account.status === 'auth_failed' && (
        <Alert
          severity="error"
          variant="outlined"
          action={
            account.provider === 'google' ? (
              // Signing in to the same Google address again keeps its calendars and their use.
              <Button color="inherit" size="small" href={GOOGLE_CONNECT_PATH}>
                {t('calendars.account.reconnect')}
              </Button>
            ) : (
              <Button color="inherit" size="small" onClick={onReconnect}>
                {t('calendars.account.reconnect')}
              </Button>
            )
          }
          sx={{ mb: 1 }}
        >
          {account.problem === 'calendar_google_client_changed'
            ? problemText(account.problem)
            : t(
                account.provider === 'google'
                  ? 'calendars.account.authGoogle'
                  : 'calendars.account.auth',
              )}
        </Alert>
      )}
      {account.calendars.map((link) => (
        <CalendarRow
          key={link.id}
          link={link}
          tagName={tagName}
          busy={busyLinks.has(link.id) || account.status === 'auth_failed'}
          problem={rowProblems[link.id] ?? null}
          onPick={(mode) => onMode(link, mode)}
        />
      ))}
      {account.calendars.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
          {t('calendars.account.empty')}
        </Typography>
      )}
      {account.canCreateCalendar && account.status !== 'auth_failed' && (
        <ButtonBase
          onClick={onCreate}
          sx={{
            display: 'flex',
            justifyContent: 'flex-start',
            gap: 1.5,
            width: 'calc(100% + 16px)',
            mx: -1,
            px: 1,
            py: 1,
            borderRadius: 2,
            color: 'primary.main',
            typography: 'body1',
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <PlusIcon fontSize="small" />
          {t('calendars.account.create')}
        </ButtonBase>
      )}
      {note && (
        <Typography variant="caption" color="error" component="div">
          {note}
        </Typography>
      )}
    </Section>
  );
}
