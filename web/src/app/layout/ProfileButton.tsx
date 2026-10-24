import BarChartRounded from '@mui/icons-material/BarChartRounded';
import KeyRounded from '@mui/icons-material/KeyRounded';
import KeyboardRounded from '@mui/icons-material/KeyboardRounded';
import LogoutRounded from '@mui/icons-material/LogoutRounded';
import SettingsRounded from '@mui/icons-material/SettingsRounded';
import {
  Box,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useAdminApi } from '../admin/useAdmin.ts';
import { Avatar } from '../friends/Avatar.tsx';
import { t } from '../i18n/i18n.ts';
import { AccountIcon, PeopleIcon, ShieldIcon } from '../icons/icons.tsx';
import { useStoreState } from '../store/hooks.ts';
import { ChangePasswordDialog } from '../sync/SyncButton.tsx';
import { leaveFor, rememberProvider } from '../sync/signInWith.ts';
import { useSyncState } from '../sync/syncContext.ts';

const NO_COLOR = '#B8BCC4';

/** The provider's name for "Signed in with ...", from the sign-in options. */
function useProviderName(provider: string | null | undefined): string | null {
  const transport = useSyncState((state) => state.transport);
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (!provider || !transport.signInOptions) return;
    let live = true;
    transport.signInOptions('/').then(
      (options) => {
        if (live)
          setName(
            options.providers.find((each) => each.name === provider)?.displayName ?? provider,
          );
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [provider, transport]);
  return provider ? (name ?? provider) : null;
}

/**
 * The profile picture in the top right (spec: PL-086), and its menu: everything about the person
 * (settings, admin, stats, friends and groups, shortcuts, password, log out). The picture is their
 * initials on their color, with the identity provider's icon when they signed in through one.
 */
export function ProfileButton({ onShortcuts }: { onShortcuts: () => void }) {
  const account = useSyncState((state) => state.account);
  const signOut = useSyncState((state) => state.signOut);
  const admin = useAdminApi();
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [changing, setChanging] = useState(false);
  const theme = useTheme();
  // Phones have no keyboard to take shortcuts.
  const phone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const local = account?.authMode === 'local';
  const me = useStoreState((state) =>
    account ? state.workspace?.entities.users.find((user) => user.id === account.id) : undefined,
  );
  const providerName = useProviderName(local ? account.provider : null);
  const name = me?.displayName || (local ? account.username : '');
  const badge = local ? account.providerIcon : null;

  const picture = (size: number) =>
    name ? (
      <Avatar name={name} color={me?.avatarColor ?? NO_COLOR} size={size} badge={badge} />
    ) : (
      <Box
        sx={{
          width: size,
          height: size,
          borderRadius: '50%',
          bgcolor: 'action.selected',
          display: 'grid',
          placeItems: 'center',
          color: 'text.secondary',
        }}
      >
        <AccountIcon fontSize="small" />
      </Box>
    );

  const close = () => setAnchor(null);
  const item = (label: string, icon: ReactNode, run: () => void) => (
    <MenuItem
      onClick={() => {
        close();
        run();
      }}
    >
      <ListItemIcon>{icon}</ListItemIcon>
      <ListItemText>{label}</ListItemText>
    </MenuItem>
  );

  const label = name ? t('profile.menuFor', { name }) : t('profile.menu');
  return (
    <>
      <Tooltip title={label}>
        <IconButton
          aria-label={label}
          aria-haspopup="menu"
          onClick={(event) => setAnchor(event.currentTarget)}
          sx={{ p: 0.5 }}
        >
          {picture(32)}
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchor}
        open={anchor !== null}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { minWidth: 240, maxWidth: 320 } } }}
      >
        {name && (
          <Box sx={{ px: 2, py: 1, display: 'flex', gap: 1.5, alignItems: 'center' }}>
            {picture(40)}
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                {name}
              </Typography>
              {local && (
                <Typography variant="caption" color="text.secondary" component="div" noWrap>
                  {providerName
                    ? t('profile.withProvider', {
                        username: account.username,
                        provider: providerName,
                      })
                    : `@${account.username}`}
                </Typography>
              )}
            </Box>
          </Box>
        )}
        {name && <Divider />}
        {item(
          t('nav.settings'),
          <SettingsRounded fontSize="small" />,
          () => void navigate('/settings'),
        )}
        {admin &&
          item(t('nav.admin'), <ShieldIcon fontSize="small" />, () => void navigate('/admin'))}
        {local &&
          item(
            t('profile.stats'),
            <BarChartRounded fontSize="small" />,
            () => void navigate('/stats'),
          )}
        {local &&
          item(
            t('profile.friends'),
            <PeopleIcon fontSize="small" />,
            () => void navigate('/friends'),
          )}
        {!phone && item(t('profile.shortcuts'), <KeyboardRounded fontSize="small" />, onShortcuts)}
        {local && <Divider />}
        {local &&
          item(t('sync.changePassword'), <KeyRounded fontSize="small" />, () => setChanging(true))}
        {local &&
          item(t('profile.logOut'), <LogoutRounded fontSize="small" />, () => {
            // Signing out on purpose: the sign-in page waits instead of going back to a provider.
            rememberProvider(null);
            void signOut().then((redirect) => redirect && leaveFor(redirect));
          })}
      </Menu>
      {changing && <ChangePasswordDialog onClose={() => setChanging(false)} />}
    </>
  );
}
