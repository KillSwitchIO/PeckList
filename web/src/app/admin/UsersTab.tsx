import {
  Alert,
  Avatar,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputBase,
  Menu,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import { useState, type FormEvent } from 'react';
import type { AccountRole, AdminApi, AdminIdentity, AdminUser } from '../../ports/admin.ts';
import { t } from '../i18n/i18n.ts';
import { MoreIcon, PlusIcon } from '../icons/icons.tsx';
import { useSyncState } from '../sync/syncContext.ts';
import { ConfirmDialog, SecretDialog } from './AdminDialogs.tsx';
import { DeleteUserDialog } from './DeleteUserDialog.tsx';
import { LinkIdentityDialog } from './LinkIdentityDialog.tsx';
import { FriendsDialog } from './FriendsDialog.tsx';
import { HandOverDialog } from './HandOverDialog.tsx';
import { SetupCard } from './SetupCard.tsx';
import { ViewAsDialog } from './ViewAsDialog.tsx';
import { refusalText, useIsSuperAdmin, useLoaded } from './useAdmin.ts';

const ROLES: AccountRole[] = ['user', 'admin', 'superadmin'];

/** One line under the name: role, how they sign in, and anything that needs attention. */
function describe(user: AdminUser): string {
  if (user.removedAt) {
    const day = new Date(user.removedAt).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
    return `${t(`admin.role.${user.role}`)} · ${t('admin.users.deleted', { date: day })}`;
  }
  const parts = [t(`admin.role.${user.role}`)];
  if (user.hasPassword) parts.push(t('admin.users.password'));
  parts.push(...user.providers);
  if (user.disabled) parts.push(t('admin.users.off'));
  else if (user.mustChangePassword) parts.push(t('admin.users.mustChange'));
  return parts.join(' · ');
}

function AddUserDialog({
  api,
  open,
  onClose,
  onAdded,
}: {
  api: AdminApi;
  open: boolean;
  onClose: () => void;
  onAdded: (username: string, password: string) => void;
}) {
  const superAdmin = useIsSuperAdmin();
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<AccountRole>('user');
  const [problem, setProblem] = useState<string | null>(null);
  const close = () => {
    setUsername('');
    setRole('user');
    setProblem(null);
    onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const name = username.trim().toLowerCase();
    const result = await api.addUser(name, role);
    if (!result.ok) {
      setProblem(refusalText(result.reason));
      return;
    }
    close();
    onAdded(name, result.value.password);
  };
  return (
    <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
      <Box component="form" onSubmit={(event) => void submit(event)}>
        <DialogTitle>{t('admin.users.add')}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: '8px !important' }}>
          <TextField
            label={t('auth.username')}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoFocus
            required
            slotProps={{ htmlInput: { autoCapitalize: 'none', spellCheck: false } }}
          />
          {superAdmin && (
            <TextField
              select
              label={t('admin.users.role')}
              value={role}
              onChange={(event) => setRole(event.target.value as AccountRole)}
            >
              {ROLES.map((each) => (
                <MenuItem key={each} value={each}>
                  {t(`admin.role.${each}`)}
                </MenuItem>
              ))}
            </TextField>
          )}
          {problem && (
            <Alert severity="error" variant="outlined">
              {problem}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={close}>{t('admin.cancel')}</Button>
          <Button type="submit" variant="contained" disableElevation>
            {t('admin.users.addButton')}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

/** Admin > Users (spec: Accounts & Admin, Account management). */
export function UsersTab({ api }: { api: AdminApi }) {
  const superAdmin = useIsSuperAdmin();
  const me = useSyncState((state) => state.account?.id);
  const { data: users, reload } = useLoaded(api.users);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ title: string; value: string; hint: string } | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    text: string;
    action: string;
    run: () => void;
  } | null>(null);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; user: AdminUser } | null>(null);
  const [identities, setIdentities] = useState<AdminIdentity[]>([]);
  const [friendsOf, setFriendsOf] = useState<AdminUser | null>(null);
  const [handingOver, setHandingOver] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const [linking, setLinking] = useState<AdminUser | null>(null);
  const [viewing, setViewing] = useState<AdminUser | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const openMenu = (anchor: HTMLElement, user: AdminUser) => {
    setMenu({ anchor, user });
    setIdentities([]);
    if (user.providers.length > 0) void api.identities(user.id).then(setIdentities);
  };
  /** Close the menu, run the action, then show any refusal and refresh. */
  const act = async (
    action: () => Promise<{ ok: true } | { ok: false; reason: Parameters<typeof refusalText>[0] }>,
  ) => {
    setMenu(null);
    setProblem(null);
    const result = await action();
    if (!result.ok) setProblem(refusalText(result.reason));
    reload();
  };

  const wanted = query.trim().toLowerCase();
  const shown = (users ?? []).filter((user) => user.username.includes(wanted));
  const target = menu?.user;
  const canTouch = target !== undefined && (superAdmin || target.role === 'user');

  return (
    <Box sx={{ maxWidth: 720 }}>
      <SetupCard api={api} />
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1.5 }}>
        <InputBase
          placeholder={t('admin.users.search')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          inputProps={{ 'aria-label': t('admin.users.search') }}
          sx={{ flexGrow: 1, px: 1.5, py: 0.5, borderRadius: 2, bgcolor: 'action.hover' }}
        />
        <Button startIcon={<PlusIcon />} onClick={() => setAdding(true)}>
          {t('admin.users.add')}
        </Button>
      </Box>
      {problem && (
        <Alert
          severity="error"
          variant="outlined"
          sx={{ mb: 1.5 }}
          onClose={() => setProblem(null)}
        >
          {problem}
        </Alert>
      )}
      {notice && (
        <Alert
          severity="success"
          variant="outlined"
          sx={{ mb: 1.5 }}
          onClose={() => setNotice(null)}
        >
          {notice}
        </Alert>
      )}
      <Box role="list" aria-label={t('admin.tab.users')}>
        {shown.map((user) => (
          <Box
            key={user.id}
            role="listitem"
            aria-label={user.username}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              px: 1,
              py: 1,
              borderRadius: 2,
              opacity: user.disabled ? 0.6 : 1,
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            <Avatar sx={{ width: 32, height: 32, fontSize: '0.875rem' }}>
              {user.username.slice(0, 1).toUpperCase()}
            </Avatar>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography noWrap>{user.username}</Typography>
              <Typography variant="caption" color="text.secondary" noWrap component="div">
                {describe(user)}
              </Typography>
            </Box>
            <IconButton
              size="small"
              aria-label={t('admin.users.actions', { name: user.username })}
              onClick={(event) => openMenu(event.currentTarget, user)}
            >
              <MoreIcon fontSize="small" />
            </IconButton>
          </Box>
        ))}
      </Box>

      <Menu anchorEl={menu?.anchor} open={menu !== null} onClose={() => setMenu(null)}>
        {target && (
          <MenuItem
            onClick={() => {
              setMenu(null);
              setFriendsOf(target);
            }}
          >
            {t('admin.users.friends')}
          </MenuItem>
        )}
        {target && (
          <MenuItem
            onClick={() => {
              setMenu(null);
              setHandingOver(target);
            }}
          >
            {t('admin.users.handOver')}
          </MenuItem>
        )}
        {target && (
          <MenuItem
            component="a"
            href={api.userExportUrl(target.id)}
            download
            onClick={() => setMenu(null)}
          >
            {t('admin.users.export')}
          </MenuItem>
        )}
        {target &&
          superAdmin &&
          target.id !== me &&
          target.role !== 'superadmin' &&
          !target.disabled && (
            <MenuItem
              onClick={() => {
                setMenu(null);
                setViewing(target);
              }}
            >
              {t('admin.users.viewAs', { name: target.username })}
            </MenuItem>
          )}
        {target && !canTouch && <MenuItem disabled>{t('admin.refused.admins-only')}</MenuItem>}
        {target && canTouch && target.deletedAt && (
          <MenuItem onClick={() => void act(() => api.restoreAccount(target.id))}>
            {t('admin.users.restore')}
          </MenuItem>
        )}
        {target &&
          canTouch &&
          !target.deletedAt && [
            <MenuItem
              key="password"
              onClick={() =>
                void act(async () => {
                  const result = await api.resetPassword(target.id);
                  if (result.ok) {
                    setSecret({
                      title: t('admin.users.newPassword', { name: target.username }),
                      value: result.value,
                      hint: t('admin.users.newPasswordHint'),
                    });
                  }
                  return result;
                })
              }
            >
              {t('admin.users.resetPassword')}
            </MenuItem>,
            <MenuItem
              key="link"
              onClick={() =>
                void act(async () => {
                  const result = await api.loginLink(target.id);
                  if (result.ok) {
                    setSecret({
                      title: t('admin.users.link', { name: target.username }),
                      value: result.value.url,
                      hint: t('admin.users.linkHint'),
                    });
                  }
                  return result;
                })
              }
            >
              {t('admin.users.signInLink')}
            </MenuItem>,
            target.id !== me && (
              <MenuItem
                key="off"
                onClick={() => {
                  setMenu(null);
                  if (target.disabled) {
                    void act(() => api.setDisabled(target.id, false));
                    return;
                  }
                  setConfirm({
                    title: t('admin.users.turnOffTitle', { name: target.username }),
                    text: t('admin.users.turnOffText'),
                    action: t('admin.users.turnOff'),
                    run: () => void act(() => api.setDisabled(target.id, true)),
                  });
                }}
              >
                {target.disabled ? t('admin.users.turnOn') : t('admin.users.turnOff')}
              </MenuItem>
            ),
            <MenuItem
              key="link-provider"
              onClick={() => {
                setMenu(null);
                setLinking(target);
              }}
            >
              {t('admin.link.menu')}
            </MenuItem>,
            target.id !== me && (
              <MenuItem
                key="delete"
                onClick={() => {
                  setMenu(null);
                  setDeleting(target);
                }}
                sx={{ color: 'error.main' }}
              >
                {t('admin.users.deleteMenu')}
              </MenuItem>
            ),
            superAdmin && <Divider key="roles" />,
            ...(superAdmin
              ? ROLES.filter((role) => role !== target.role).map((role) => (
                  <MenuItem key={role} onClick={() => void act(() => api.setRole(target.id, role))}>
                    {t(`admin.users.makeRole.${role}`)}
                  </MenuItem>
                ))
              : []),
            identities.length > 0 && <Divider key="ids" />,
            ...identities.map((identity) => (
              <MenuItem
                key={`${identity.provider}:${identity.subject}`}
                onClick={() => {
                  setMenu(null);
                  setConfirm({
                    title: t('admin.users.unlinkTitle', {
                      provider: identity.displayName,
                      name: target.username,
                    }),
                    text: t('admin.users.unlinkText'),
                    action: t('settings.signIn.unlink'),
                    run: () =>
                      void act(async () => {
                        const result = await api.unlink(
                          target.id,
                          identity.provider,
                          identity.subject,
                        );
                        if (result.ok && result.value.stranded) {
                          setProblem(t('admin.users.stranded', { name: target.username }));
                        }
                        return result;
                      }),
                  });
                }}
              >
                {t('settings.signIn.unlinkNamed', { name: identity.displayName })}
              </MenuItem>
            )),
          ]}
      </Menu>

      <AddUserDialog
        api={api}
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={(name, password) => {
          reload();
          setSecret({
            title: t('admin.users.addedPassword', { name }),
            value: password,
            hint: t('admin.users.newPasswordHint'),
          });
        }}
      />
      <SecretDialog secret={secret} onClose={() => setSecret(null)} />
      {viewing && <ViewAsDialog api={api} user={viewing} onClose={() => setViewing(null)} />}
      {handingOver && (
        <HandOverDialog
          api={api}
          user={handingOver}
          users={users ?? []}
          onClose={() => setHandingOver(null)}
          onDone={(moved) => setNotice(t('admin.handOver.done', { count: moved }))}
        />
      )}
      {friendsOf && (
        <FriendsDialog
          api={api}
          user={friendsOf}
          users={users ?? []}
          onClose={() => setFriendsOf(null)}
        />
      )}
      {linking && (
        <LinkIdentityDialog
          api={api}
          user={linking}
          onClose={() => setLinking(null)}
          onLinked={(name) => {
            setNotice(t('admin.link.done', { name }));
            reload();
          }}
        />
      )}
      {deleting && (
        <DeleteUserDialog
          api={api}
          user={deleting}
          onClose={() => setDeleting(null)}
          onHandOver={() => {
            setHandingOver(deleting);
            setDeleting(null);
          }}
          onDelete={() => {
            const user = deleting;
            setDeleting(null);
            void act(async () => {
              const result = await api.deleteUser(user.id);
              if (result.ok) setNotice(t('admin.users.deletedNotice', { name: user.username }));
              return result.ok ? { ok: true as const } : result;
            });
          }}
        />
      )}
      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
    </Box>
  );
}
