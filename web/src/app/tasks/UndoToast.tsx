import UndoRounded from '@mui/icons-material/UndoRounded';
import { Box, ButtonBase, CircularProgress, Tooltip } from '@mui/material';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../i18n/i18n.ts';
import { useStoreState } from '../store/hooks.ts';
import { countUse } from '../telemetry/usage.ts';
import { visuallyHidden } from '../layout/visuallyHidden.ts';
import { holdLateTaps, releaseLateTaps } from './lateTaps.ts';
import { commitOutsideUndo, undoOutsideUndo, useOutsideUndo } from './outsideUndo.ts';

/** How long Undo stays. */
const SHOW_MS = 6000;
/** A sideways swipe this far sends it away. */
const AWAY_PX = 48;
const SIZE = 48;

/**
 * Undo after a change (spec: R-FB-68): a small round button off to the side, a ring running down
 * the time it stays, rather than a bar across the screen. Swipe it left or right to send it away
 * sooner; touching it, or nudging it less than that, starts the time over (R-FB-119). What
 * changed is read out to screen readers and shows on hover. A change held outside the workspace
 * (hiding a calendar's event) shows the same way, and is made when the button goes. For a moment
 * after it goes, a tap where it was is let fall, so a late tap at Undo opens nothing underneath.
 */
export function UndoToast({
  bottomOffset = 0,
  wideBottomOffset = 0,
}: {
  /** Room to keep below it on a phone */
  bottomOffset?: number;
  /** Room to keep below it on bigger screens (the + button) */
  wideBottomOffset?: number;
}) {
  const stored = useStoreState((state) => state.lastUndoable);
  const undoStored = useStoreState((state) => state.undo);
  const dismissStored = useStoreState((state) => state.dismissUndo);
  const outside = useOutsideUndo();
  // A workspace change while one is held outside is the newer: the held one is made.
  const entry = stored
    ? { key: `store:${stored.id}`, label: stored.label }
    : outside
      ? { key: `outside:${outside.id}`, label: outside.label }
      : null;
  useEffect(() => {
    if (stored && outside) commitOutsideUndo();
  }, [stored, outside]);
  const dismiss = stored ? dismissStored : commitOutsideUndo;
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState(0);
  const [shown, setShown] = useState(entry?.key ?? null);
  // Bumped to start the time over.
  const [round, setRound] = useState(0);
  const swiped = useRef(false);
  const latest = useRef(dismiss);
  useEffect(() => {
    latest.current = dismiss;
  });
  // A new change: back in place.
  if ((entry?.key ?? null) !== shown) {
    setShown(entry?.key ?? null);
    setDx(0);
    setLeaving(0);
  }
  // Gone after a while.
  const showing = entry?.key ?? null;
  useEffect(() => {
    if (!showing) return;
    const timer = setTimeout(() => latest.current(), SHOW_MS);
    return () => clearTimeout(timer);
  }, [showing, round]);
  // Where it rests (not mid-swipe), for the taps that come just too late once it goes.
  const box = useRef<HTMLDivElement>(null);
  const restingAt = useRef<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (box.current && !dx && !leaving) restingAt.current = box.current.getBoundingClientRect();
  });
  const wasShowing = useRef(false);
  useLayoutEffect(() => {
    if (showing) releaseLateTaps();
    else if (wasShowing.current && restingAt.current) holdLateTaps(restingAt.current);
    wasShowing.current = !!showing;
  }, [showing]);

  if (!entry) return null;

  const press = (event: React.PointerEvent<HTMLElement>) => {
    const x0 = event.clientX;
    const id = event.pointerId;
    swiped.current = false;
    setRound((n) => n + 1);
    const move = (next: PointerEvent) => {
      if (next.pointerId !== id) return;
      const by = next.clientX - x0;
      if (Math.abs(by) > 6) swiped.current = true;
      setDx(by);
    };
    const up = (next: PointerEvent) => {
      if (next.pointerId !== id) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const by = next.clientX - x0;
      if (Math.abs(by) >= AWAY_PX) {
        setLeaving(Math.sign(by));
        setTimeout(() => latest.current(), 150);
      } else {
        setDx(0);
        setRound((n) => n + 1);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  return (
    <Box
      ref={box}
      sx={{
        position: 'fixed',
        // Phones: bottom left, clear of the add button on the right. Bigger screens: bottom right.
        left: { xs: 16, sm: 'auto' },
        right: { xs: 'auto', sm: 24 },
        bottom: { xs: 16 + bottomOffset, sm: 24 + wideBottomOffset },
        zIndex: (theme) => theme.zIndex.snackbar,
        transform: leaving
          ? `translateX(${leaving * 200}px)`
          : dx
            ? `translateX(${dx}px)`
            : undefined,
        opacity: leaving ? 0 : Math.max(0.3, 1 - Math.abs(dx) / 120),
        transition: dx && !leaving ? 'none' : 'transform 150ms ease-out, opacity 150ms ease-out',
        touchAction: 'pan-y',
      }}
    >
      <Box role="status" aria-live="polite" sx={visuallyHidden}>
        {entry.label}
      </Box>
      <Tooltip title={entry.label} placement="top">
        <ButtonBase
          key={entry.key}
          aria-label={t('common.undo')}
          onPointerDown={press}
          onClick={() => {
            if (swiped.current) return;
            countUse('undo');
            if (stored) undoStored(stored.id);
            else undoOutsideUndo();
          }}
          sx={{
            position: 'relative',
            width: SIZE,
            height: SIZE,
            borderRadius: '50%',
            bgcolor: 'text.primary',
            color: 'background.paper',
            boxShadow: 6,
            animation: 'undo-pop 160ms ease-out',
            '@keyframes undo-pop': { from: { transform: 'scale(0.6)', opacity: 0 } },
          }}
        >
          <UndoRounded />
          {/* The time left, running down round the edge. */}
          <CircularProgress
            key={round}
            aria-hidden
            variant="determinate"
            value={100}
            size={SIZE}
            thickness={2.5}
            sx={{
              position: 'absolute',
              inset: 0,
              // Presses go to the button: the ring starts over (a new one) on each press, and a
              // click whose press landed on the old ring never came (R-FB-151).
              pointerEvents: 'none',
              color: 'primary.main',
              '& circle': { animation: `undo-ring ${SHOW_MS}ms linear forwards` },
              '@keyframes undo-ring': {
                from: { strokeDashoffset: 0 },
                to: { strokeDashoffset: 2 * Math.PI * ((SIZE - 2.5) / 2) },
              },
            }}
          />
        </ButtonBase>
      </Tooltip>
    </Box>
  );
}
