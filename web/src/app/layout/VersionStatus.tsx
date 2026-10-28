import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import ErrorRounded from '@mui/icons-material/ErrorRounded';
import { Box, Button, IconButton, Paper, Popover, Stack, Tooltip, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { isNewer } from '../../core/versions.ts';
import type { UpdateInfo } from '../../ports/sync.ts';
import { t } from '../i18n/i18n.ts';
import { useShellInfo } from '../native/shell.ts';
import { useSyncState } from '../sync/syncContext.ts';

/** Where "Skip this release" is remembered on this device. */
const SKIPPED_KEY = 'punchlist.skippedRelease';
/** How often the menu asks the server again. */
const RECHECK_MS = 6 * 60 * 60 * 1000;

/**
 * A green check (all is well) or a yellow ! (an update is due) beside a version (R-FB-147).
 * Hovering says why; a click (or tap) opens the same, with `action` when there is something to do.
 */
export function StatusMark({
  ok,
  explanation,
  action,
}: {
  ok: boolean;
  explanation: string;
  action?: { label: string; run: () => void };
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <Tooltip title={anchor ? '' : explanation}>
        <IconButton
          size="small"
          aria-label={ok ? t('version.ok') : t('version.needsUpdate')}
          aria-haspopup="dialog"
          onClick={(event) => {
            event.stopPropagation();
            setAnchor(event.currentTarget);
          }}
          sx={{ p: 0.25, ml: 0.5, color: ok ? 'success.main' : 'warning.main' }}
        >
          {ok ? (
            <CheckCircleRounded sx={{ fontSize: 14 }} />
          ) : (
            <ErrorRounded sx={{ fontSize: 14 }} />
          )}
        </IconButton>
      </Tooltip>
      <Popover
        open={anchor !== null}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        slotProps={{ paper: { role: 'dialog', sx: { p: 1.5, maxWidth: 280 } } }}
      >
        <Typography variant="body2">{explanation}</Typography>
        {action && (
          <Button size="small" sx={{ mt: 1 }} onClick={action.run}>
            {action.label}
          </Button>
        )}
      </Popover>
    </>
  );
}

function skipped(): string | null {
  try {
    return localStorage.getItem(SKIPPED_KEY);
  } catch {
    return null;
  }
}

/** What the server knows of releases, asked when the menu shows and every few hours after. */
function useLatestRelease(): UpdateInfo | null {
  const api = useSyncState((state) => state.transport.updates);
  const phase = useSyncState((state) => state.phase);
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  useEffect(() => {
    if (!api || phase !== 'ready') return;
    let live = true;
    const ask = () =>
      api.latest().then(
        (answer) => live && setInfo(answer),
        () => undefined,
      );
    void ask();
    const timer = setInterval(() => void ask(), RECHECK_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [api, phase]);
  return info;
}

/**
 * At the foot of the menu, as Immich does (R-FB-148): a newer Punchlist release is out than this
 * server or this Android app runs. "Skip this release" hides it until the next one; "Release page"
 * opens its notes and downloads. Nothing shows while the server finds no release (the check off,
 * offline, or the project not public yet).
 */
export function UpdateNotice() {
  const release = useLatestRelease();
  const { info: shell } = useShellInfo();
  const [skip, setSkip] = useState(skipped);
  const latest = release?.latest ?? null;
  if (!release || !latest || skip === latest) return null;
  const serverBehind = isNewer(latest, release.current);
  const appBehind = shell !== null && isNewer(latest, shell.version);
  if (!serverBehind && !appBehind) return null;
  return (
    <Paper
      variant="outlined"
      role="status"
      aria-label={t('update.title')}
      sx={{ mx: 1.5, mb: 1, p: 1.25, borderRadius: 2, borderColor: 'warning.main' }}
    >
      <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <ErrorRounded sx={{ fontSize: 16, color: 'warning.main' }} />
        {t('update.title')}
      </Typography>
      <Stack spacing={0.25} sx={{ mt: 0.5 }}>
        {serverBehind && (
          <Typography variant="caption" color="text.secondary">
            {t('update.server', { latest, current: release.current })}
          </Typography>
        )}
        {appBehind && (
          <Typography variant="caption" color="text.secondary">
            {t('update.app', { latest, current: shell.version })}
          </Typography>
        )}
      </Stack>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, mt: 0.75 }}>
        <Button
          size="small"
          color="inherit"
          sx={{ color: 'text.secondary', px: 0.5, minWidth: 0 }}
          onClick={() => {
            try {
              localStorage.setItem(SKIPPED_KEY, latest);
            } catch {
              // Not remembered: it hides for now all the same.
            }
            setSkip(latest);
          }}
        >
          {t('update.skip')}
        </Button>
        {release.releaseUrl && (
          <Button
            size="small"
            href={release.releaseUrl}
            target="_blank"
            rel="noreferrer"
            sx={{ px: 0.5, minWidth: 0 }}
          >
            {t('update.notes')}
          </Button>
        )}
      </Box>
    </Paper>
  );
}
