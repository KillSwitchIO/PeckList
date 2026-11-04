import {
  Box,
  Button,
  ButtonBase,
  IconButton,
  Paper,
  Popover,
  Tooltip,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { t } from '../i18n/i18n.ts';
import { CloseIcon, CopyIcon } from '../icons/icons.tsx';
import { useSyncState } from '../sync/syncContext.ts';
import { bannerDismissed, dismissBanner, resetWording } from './demoBanner.ts';

/**
 * On a demo server (`DEMO_MODE`, PL-117): one line saying it resets every night and anyone can
 * sign up, the demo accounts behind a button, and a close that lasts the session. It floats, so
 * nothing on the page moves when it comes or goes. The accounts are a small table that says which
 * value is the username and which the password, each with a copy button.
 */
export function DemoBanner() {
  const demo = useSyncState((state) => state.server?.demo);
  const [hidden, setHidden] = useState(bannerDismissed);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  if (!demo || hidden) return null;
  const accounts = demo.accounts;
  const words = resetWording(demo);
  return (
    <Paper
      role="status"
      aria-label={t('demo.label')}
      elevation={4}
      sx={{
        position: 'fixed',
        // Phones: beside the + button, above the bottom tabs. Wider: centered at the bottom
        // (both sides pinned and auto margins, so the whole width is there to grow into).
        left: { xs: 16, sm: 0 },
        right: { xs: 'auto', sm: 0 },
        mx: { sm: 'auto' },
        width: 'fit-content',
        bottom: { xs: 'calc(68px + env(safe-area-inset-bottom))', sm: 24 },
        maxWidth: { xs: 'calc(100vw - 104px)', sm: 'calc(100vw - 48px)' },
        zIndex: (theme) => theme.zIndex.snackbar - 1,
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        pl: 2,
        pr: 0.5,
        py: 0.25,
        borderRadius: 999,
      }}
    >
      <Typography variant="body2" noWrap sx={{ minWidth: 0, display: { xs: 'none', sm: 'block' } }}>
        {words.banner}
      </Typography>
      {/* A phone has room for the short line only; it opens the rest. */}
      <ButtonBase
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{ minWidth: 0, borderRadius: 1, display: { xs: 'flex', sm: 'none' } }}
      >
        <Typography variant="body2" noWrap>
          {words.short}
        </Typography>
      </ButtonBase>
      {accounts.length > 0 && (
        <Button
          size="small"
          onClick={(event) => setAnchor(event.currentTarget)}
          sx={{ flexShrink: 0, fontWeight: 600, display: { xs: 'none', sm: 'inline-flex' } }}
        >
          {t('demo.accounts')}
        </Button>
      )}
      <IconButton
        size="small"
        aria-label={t('demo.dismiss')}
        onClick={() => {
          dismissBanner();
          setHidden(true);
        }}
        sx={{ flexShrink: 0 }}
      >
        <CloseIcon fontSize="small" />
      </IconButton>
      <Popover
        open={anchor !== null}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        slotProps={{ paper: { sx: { p: 2, maxWidth: 340, mb: 1 } } }}
      >
        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
          {t('demo.accountsTitle')}
        </Typography>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mb: accounts.length > 0 ? 1.5 : 0 }}
        >
          {accounts.length > 0 ? words.accounts : words.noAccounts}
        </Typography>
        {accounts.length > 0 && (
          <Box
            component="table"
            sx={{
              borderCollapse: 'collapse',
              width: '100%',
              '& td, & th': { p: 0, pr: 1.5, py: 0.25 },
            }}
          >
            <thead>
              <tr>
                <Typography component="th" variant="caption" color="text.secondary" align="left">
                  {t('demo.username')}
                </Typography>
                <Typography component="th" variant="caption" color="text.secondary" align="left">
                  {t('demo.password')}
                </Typography>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.username}>
                  <td>
                    <Copyable
                      value={account.username}
                      label={t('demo.copyUsername', { name: account.username })}
                      copied={copied === `u:${account.username}`}
                      onCopied={() => setCopied(`u:${account.username}`)}
                    />
                  </td>
                  <td>
                    <Copyable
                      value={account.password}
                      label={t('demo.copyPassword', { name: account.username })}
                      copied={copied === `p:${account.username}`}
                      onCopied={() => setCopied(`p:${account.username}`)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </Box>
        )}
      </Popover>
    </Paper>
  );
}

/** One value to type in, in monospace and selectable at a click, with a button that copies it. */
function Copyable({
  value,
  label,
  copied,
  onCopied,
}: {
  value: string;
  label: string;
  copied: boolean;
  onCopied: () => void;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
      <Typography variant="body2" sx={{ fontFamily: 'monospace', userSelect: 'all' }}>
        {value}
      </Typography>
      <Tooltip title={copied ? t('demo.copied') : label}>
        <IconButton
          size="small"
          aria-label={label}
          onClick={() => void navigator.clipboard?.writeText(value).then(onCopied, () => undefined)}
        >
          <CopyIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
