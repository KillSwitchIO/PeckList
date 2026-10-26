import { Box, CircularProgress, Paper } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n/i18n.ts';
import { RefreshIcon } from '../icons/icons.tsx';
import { nativeShell } from '../native/shell.ts';
import { useSyncState } from './syncContext.ts';

/** How far to pull before letting go syncs, and the most the circle travels. */
export const PULL_TRIGGER = 72;
const PULL_MAX = 112;
/** A touch held this long before moving is a drag (tasks move on a hold), not a pull. */
const HOLD_MS = 350;
/** The spinner stays at least this long, so a quick sync still reads as one. */
const MIN_SPIN_MS = 600;

/** Where pulling to refresh is ours: the Android app and an installed app, not a browser tab (it has its own). */
function pullToRefreshHere(): boolean {
  if (nativeShell()) return true;
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches
  );
}

/** Whether the touch began where a pull means refresh: the page at its top, nothing above it open or scrolled. */
function pullable(target: EventTarget | null): boolean {
  if (window.scrollY > 0) return false;
  const open = [...document.querySelectorAll('.MuiModal-root')].some(
    (each) => !each.classList.contains('MuiModal-hidden'),
  );
  if (open) return false;
  for (let node = target instanceof Element ? target : null; node; node = node.parentElement) {
    if (node.scrollTop > 0) return false;
  }
  return true;
}

/**
 * Pull down at the top to sync (the Android app and installed apps, where the browser's own
 * pull-to-refresh is not there): a circle follows the finger like Chrome's, and letting go past the
 * line syncs now, spinning until it is done.
 */
export function PullToRefresh() {
  const phase = useSyncState((state) => state.phase);
  const syncNow = useSyncState((state) => state.syncNow);
  const [pull, setPull] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const latest = useRef({ syncNow, syncing });
  useEffect(() => {
    latest.current = { syncNow, syncing };
  });
  const enabled = phase === 'ready' && pullToRefreshHere();

  useEffect(() => {
    if (!enabled) return;
    // No stretch or glow at the top: the circle is what a pull shows.
    const root = document.documentElement;
    const before = root.style.overscrollBehaviorY;
    root.style.overscrollBehaviorY = 'none';
    let start: { y: number; at: number } | null = null;
    let distance = 0;
    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      start =
        event.touches.length === 1 && touch && !latest.current.syncing && pullable(event.target)
          ? { y: touch.clientY, at: Date.now() }
          : null;
      distance = 0;
    };
    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!start || !touch) return;
      const down = touch.clientY - start.y;
      if (distance === 0 && (down <= 0 || Date.now() - start.at > HOLD_MS || window.scrollY > 0)) {
        start = null;
        return;
      }
      // Resists the further it goes, as a pull does.
      distance = Math.min(PULL_MAX, down * 0.5);
      if (event.cancelable) event.preventDefault();
      setPull(distance);
    };
    const onEnd = () => {
      if (!start) return;
      start = null;
      const pulled = distance;
      distance = 0;
      setPull(0);
      if (pulled < PULL_TRIGGER) return;
      setSyncing(true);
      const began = Date.now();
      void latest.current
        .syncNow()
        .catch(() => undefined)
        .finally(() => {
          setTimeout(() => setSyncing(false), Math.max(0, MIN_SPIN_MS - (Date.now() - began)));
        });
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      root.style.overscrollBehaviorY = before;
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [enabled]);

  if (!enabled || (pull === 0 && !syncing)) return null;
  const offset = syncing ? PULL_TRIGGER : pull;
  const ready = pull >= PULL_TRIGGER;
  return (
    <Box
      role="status"
      aria-label={syncing ? t('sync.syncing') : t('sync.pullToRefresh')}
      sx={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: (theme) => theme.zIndex.appBar + 1,
        transform: `translateY(${offset}px)`,
        transition: pull === 0 ? 'transform 150ms ease-out' : 'none',
      }}
    >
      <Paper
        elevation={3}
        sx={{
          width: 40,
          height: 40,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          color: 'primary.main',
        }}
      >
        {syncing ? (
          <CircularProgress size={22} thickness={5} />
        ) : (
          <RefreshIcon
            fontSize="small"
            sx={{ transform: `rotate(${pull * 3}deg)`, opacity: ready ? 1 : 0.6 }}
          />
        )}
      </Paper>
    </Box>
  );
}
