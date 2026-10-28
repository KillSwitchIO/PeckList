import { Box, ButtonBase } from '@mui/material';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { swipeLook } from './swipeLook.tsx';
import { useSwipePrefs, type SwipeAction } from './swipePrefs.ts';

/** Width of each button a short swipe shows. */
const ACTION = 60;
/** A sideways move this far decides it is a swipe (not a tap or the start of a hold). */
const DECIDE_PX = 10;
/** A short swipe this far stays open on its buttons. */
const OPEN_PX = 48;

// One row open at a time: opening another closes it.
let closeOpen: (() => void) | null = null;

const fill = (color: string) =>
  color === 'grey'
    ? { bgcolor: 'grey.600', color: 'common.white' }
    : { bgcolor: `${color}.main`, color: `${color}.contrastText` };

/**
 * TickTick's swipes on a task row (spec: Interactions, swipe; R-FB-54), for fingers only. Each
 * side shows its buttons on a short swipe and does its full-swipe action on a long one, as set in
 * Settings. Up and down still scroll, and a hold still drags or opens the menu.
 */
export function SwipeRow({
  enabled,
  done,
  pinned,
  run,
  children,
}: {
  enabled: boolean;
  /** Closed: Complete reopens */
  done: boolean;
  pinned: boolean;
  /** Does an action; `anchor` is the row (or the button), for a popup to open by */
  run: (action: SwipeAction, anchor: HTMLElement) => void;
  children: ReactNode;
}) {
  const prefs = useSwipePrefs();
  const root = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [live, setLive] = useState(false);
  // The row's width, taken when a swipe starts: thresholds are shares of it.
  const [rowWidth, setRowWidth] = useState(360);
  const swiped = useRef(false);
  const rightWidth = prefs.right.buttons.length * ACTION;
  const leftWidth = prefs.left.buttons.length * ACTION;
  const open = !live && offset !== 0 && (offset === rightWidth || offset === -leftWidth);
  // Clipped only while the row is slid over (and as it slides back): at rest, a top-level
  // parent's chevron sits out in the page gutter and must show (R-FB-137).
  const [clipped, setClipped] = useState(false);
  if (offset !== 0 && !clipped) setClipped(true);
  useEffect(() => {
    if (offset !== 0 || !clipped) return;
    const timer = setTimeout(() => setClipped(false), 220);
    return () => clearTimeout(timer);
  }, [offset, clipped]);
  /** How far a full swipe must go: further when there are buttons to stop on first. */
  const fullAt = (buttons: number, width: number) =>
    buttons > 0 ? width * 0.6 : Math.max(90, width * 0.33);

  // An open row closes on a touch anywhere else.
  useEffect(() => {
    if (!open) return;
    const close = () => setOffset(0);
    closeOpen?.();
    closeOpen = close;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', outside, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      if (closeOpen === close) closeOpen = null;
    };
  }, [open]);

  const press = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!enabled || event.pointerType !== 'touch') return;
    const element = root.current;
    if (!element) return;
    // A popup the row opened (its menu) is a portal, but its events still reach here: not a swipe.
    if (!element.contains(event.target as Node)) return;
    const width = element.clientWidth || 360;
    setRowWidth(width);
    const id = event.pointerId;
    const origin = { x: event.clientX, y: event.clientY };
    const from = offset;
    // A side with nothing to show or do does not move.
    const most = prefs.right.buttons.length || prefs.right.full ? width : 0;
    const least = prefs.left.buttons.length || prefs.left.full ? -width : 0;
    let deciding = true;
    swiped.current = false;

    const move = (next: PointerEvent) => {
      if (next.pointerId !== id) return;
      const dx = next.clientX - origin.x;
      const dy = next.clientY - origin.y;
      if (deciding) {
        if (Math.abs(dy) > DECIDE_PX && Math.abs(dy) > Math.abs(dx)) return finish();
        if (Math.abs(dx) < DECIDE_PX) return;
        deciding = false;
        swiped.current = true;
        setLive(true);
      }
      setOffset(Math.max(least, Math.min(most, from + dx)));
    };
    const up = (next: PointerEvent) => {
      if (next.pointerId !== id) return;
      finish();
      if (deciding) return;
      // A browser may or may not send a click after a swipe: swallow one only right away, so the
      // next real tap (a button) still works.
      setTimeout(() => {
        swiped.current = false;
      }, 300);
      const at = Math.max(least, Math.min(most, from + (next.clientX - origin.x)));
      setLive(false);
      const toward = at > 0 ? prefs.right : prefs.left;
      const shown = Math.abs(at);
      if (toward.full && shown >= fullAt(toward.buttons.length, width)) {
        const action = toward.full;
        // Completing or deleting slides the row out; the rest slide back and open their popup.
        if (action === 'complete' || action === 'delete') {
          setOffset(at > 0 ? width : -width);
          setTimeout(() => {
            run(action, element);
            setOffset(0);
          }, 160);
        } else {
          setOffset(0);
          run(action, element);
        }
      } else if (toward.buttons.length > 0 && shown >= OPEN_PX) {
        setOffset(at > 0 ? rightWidth : -leftWidth);
      } else {
        setOffset(0);
      }
    };
    const cancel = () => {
      finish();
      setLive(false);
      setOffset(from);
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  };

  const state = { done, pinned };
  const side = offset > 0 ? prefs.right : prefs.left;
  // Past the full-swipe point: the whole background says what letting go does.
  const fullNow =
    offset !== 0 && side.full && Math.abs(offset) >= fullAt(side.buttons.length, rowWidth)
      ? swipeLook(side.full, state)
      : null;

  return (
    <Box
      ref={root}
      onPointerDown={press}
      // The click that ends a swipe is not a tap on the task.
      onClickCapture={(event) => {
        if (!swiped.current) return;
        // The buttons it showed are what the finger is reaching for.
        if ((event.target as Element).closest('[data-swipe-action]')) return;
        swiped.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      sx={{
        position: 'relative',
        overflow: clipped ? 'hidden' : 'visible',
        touchAction: enabled ? 'pan-y' : undefined,
      }}
    >
      {offset !== 0 && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            justifyContent: offset > 0 ? 'flex-start' : 'flex-end',
            bgcolor: 'action.selected',
          }}
        >
          {fullNow ? (
            <Box
              aria-hidden
              sx={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: offset > 0 ? 'flex-start' : 'flex-end',
                gap: 1,
                px: 2,
                typography: 'body2',
                fontWeight: 600,
                ...fill(fullNow.color),
              }}
            >
              {fullNow.icon}
              {fullNow.label}
            </Box>
          ) : (
            side.buttons.map((action) => {
              const look = swipeLook(action, state);
              return (
                <ButtonBase
                  key={action}
                  data-swipe-action={action}
                  aria-label={look.label}
                  tabIndex={open ? 0 : -1}
                  onClick={(event) => {
                    const anchor = event.currentTarget;
                    setOffset(0);
                    run(action, anchor);
                  }}
                  sx={{
                    width: ACTION,
                    flexDirection: 'column',
                    gap: 0.25,
                    fontSize: 11,
                    ...fill(look.color),
                  }}
                >
                  {look.icon}
                  {look.label}
                </ButtonBase>
              );
            })
          )}
        </Box>
      )}
      <Box
        sx={{
          position: 'relative',
          transform: offset ? `translateX(${offset}px)` : undefined,
          transition: live ? 'none' : 'transform 160ms ease-out',
          bgcolor: offset ? 'background.default' : undefined,
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
