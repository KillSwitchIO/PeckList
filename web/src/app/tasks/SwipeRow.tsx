import CheckRounded from '@mui/icons-material/CheckRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import DriveFileMoveOutlined from '@mui/icons-material/DriveFileMoveOutlined';
import ReplayRounded from '@mui/icons-material/ReplayRounded';
import { Box, ButtonBase } from '@mui/material';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n/i18n.ts';
import { CalendarIcon } from '../icons/icons.tsx';

/** Width of each action a left swipe reveals. */
const ACTION = 56;
const ACTIONS = 3;
/** A sideways move this far decides it is a swipe (not a tap or the start of a hold). */
const DECIDE_PX = 10;

// One row open at a time: opening another closes it.
let closeOpen: (() => void) | null = null;

/**
 * TickTick's swipes on a task row (spec: Interactions, swipe), for fingers only: right completes
 * (or reopens a closed task); a short swipe left opens Date, Move and Delete, and a long one
 * deletes. Up and down still scroll, and a hold still drags or opens the menu.
 */
export function SwipeRow({
  enabled,
  done,
  onComplete,
  onDate,
  onMove,
  onDelete,
  children,
}: {
  enabled: boolean;
  /** Closed: a right swipe reopens */
  done: boolean;
  onComplete: () => void;
  onDate: (anchor: HTMLElement) => void;
  onMove: () => void;
  onDelete: () => void;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [live, setLive] = useState(false);
  // The row's width, taken when a swipe starts: thresholds are shares of it.
  const [rowWidth, setRowWidth] = useState(360);
  const swiped = useRef(false);
  const open = offset === -ACTION * ACTIONS && !live;

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
    const width = element.clientWidth || 360;
    setRowWidth(width);
    const id = event.pointerId;
    const origin = { x: event.clientX, y: event.clientY };
    const from = offset;
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
      setOffset(Math.max(-width, Math.min(width, from + dx)));
    };
    const up = (next: PointerEvent) => {
      if (next.pointerId !== id) return;
      finish();
      if (deciding) return;
      // A browser may or may not send a click after a swipe: swallow one only right away, so the
      // next real tap (an action button) still works.
      setTimeout(() => {
        swiped.current = false;
      }, 300);
      const at = from + (next.clientX - origin.x);
      setLive(false);
      if (at >= Math.max(90, width * 0.33)) {
        // Slide out, then act: the row comes back (or goes) with the change.
        setOffset(width);
        setTimeout(() => {
          onComplete();
          setOffset(0);
        }, 160);
      } else if (-at >= width * 0.6) {
        setOffset(-width);
        setTimeout(() => {
          onDelete();
          setOffset(0);
        }, 160);
      } else if (-at >= 48) {
        setOffset(-ACTION * ACTIONS);
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

  const deleting = -offset >= rowWidth * 0.6;
  const completing = offset >= Math.max(90, rowWidth * 0.33);
  const act = (action: () => void) => () => {
    setOffset(0);
    action();
  };

  return (
    <Box
      ref={root}
      onPointerDown={press}
      // The click that ends a swipe is not a tap on the task.
      onClickCapture={(event) => {
        if (!swiped.current) return;
        // The actions it revealed are what the finger is reaching for.
        if ((event.target as Element).closest('[data-swipe-action]')) return;
        swiped.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      sx={{ position: 'relative', overflow: 'hidden', touchAction: enabled ? 'pan-y' : undefined }}
    >
      {offset > 0 && (
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            pl: 2,
            gap: 1,
            bgcolor: completing ? 'primary.main' : 'action.selected',
            color: completing ? 'primary.contrastText' : 'text.secondary',
            typography: 'body2',
            fontWeight: 600,
            transition: 'background-color 120ms',
          }}
        >
          {done ? <ReplayRounded /> : <CheckRounded />}
          {done ? t('swipe.reopen') : t('swipe.complete')}
        </Box>
      )}
      {offset < 0 && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            justifyContent: 'flex-end',
            bgcolor: deleting ? 'error.main' : 'action.selected',
            transition: 'background-color 120ms',
          }}
        >
          {deleting ? (
            <Box
              aria-hidden
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                pr: 2,
                color: 'error.contrastText',
                typography: 'body2',
                fontWeight: 600,
              }}
            >
              <DeleteOutlineRounded />
              {t('swipe.delete')}
            </Box>
          ) : (
            [
              {
                key: 'date',
                label: t('swipe.date'),
                icon: <CalendarIcon />,
                run: (anchor: HTMLElement) => onDate(anchor),
              },
              {
                key: 'move',
                label: t('swipe.move'),
                icon: <DriveFileMoveOutlined />,
                run: () => onMove(),
              },
              {
                key: 'delete',
                label: t('swipe.delete'),
                icon: <DeleteOutlineRounded />,
                run: () => onDelete(),
                danger: true,
              },
            ].map((action) => (
              <ButtonBase
                key={action.key}
                data-swipe-action={action.key}
                aria-label={action.label}
                tabIndex={open ? 0 : -1}
                onClick={(event) => act(() => action.run(event.currentTarget))()}
                sx={{
                  width: ACTION,
                  flexDirection: 'column',
                  gap: 0.25,
                  fontSize: 11,
                  color: action.danger ? 'error.contrastText' : 'text.primary',
                  bgcolor: action.danger ? 'error.main' : undefined,
                }}
              >
                {action.icon}
                {action.label}
              </ButtonBase>
            ))
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
