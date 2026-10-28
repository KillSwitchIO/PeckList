import { Box, Paper, Slide } from '@mui/material';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { popupOpen } from '../hooks/keys.ts';
import { t } from '../i18n/i18n.ts';

/** How long the pointer rests at the edge before the menu slides out (a pass on the way by does not). */
const OPEN_AFTER_MS = 150;
/** How long after the pointer leaves before it slides away (a wobble past the edge does not). */
const CLOSE_AFTER_MS = 300;

/**
 * The hidden menu on a desktop (R-FB-149): a mouse resting at the window's left edge brings it
 * out over the page, and it goes again once the mouse leaves it. A menu or dialog it opened keeps
 * it out until that closes. Touch and pen never open it (the menu button does).
 */
export function PeekSidebar({ width, children }: { width: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);

  const later = (action: () => void, ms: number) => {
    clear();
    timer.current = setTimeout(action, ms);
  };
  // Open, it goes once the mouse moves off it, wherever the mouse went from (it may have slid out
  // under a mouse at rest, which never enters it). A menu or dialog it opened keeps it out.
  useEffect(() => {
    if (!open) return;
    let closing: ReturnType<typeof setTimeout> | null = null;
    const tryClose = () => {
      closing = popupOpen() ? setTimeout(tryClose, CLOSE_AFTER_MS) : null;
      if (closing === null) setOpen(false);
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || event.pointerType === 'pen') return;
      if (event.clientX > width) {
        closing ??= setTimeout(tryClose, CLOSE_AFTER_MS);
      } else if (closing !== null) {
        clearTimeout(closing);
        closing = null;
      }
    };
    document.addEventListener('pointermove', onMove);
    return () => {
      document.removeEventListener('pointermove', onMove);
      if (closing !== null) clearTimeout(closing);
    };
  }, [open, width]);

  return (
    <>
      <Box
        aria-hidden
        data-testid="sidebar-peek-edge"
        onPointerEnter={(event) => {
          if (event.pointerType !== 'touch' && event.pointerType !== 'pen')
            later(() => setOpen(true), OPEN_AFTER_MS);
        }}
        onPointerLeave={() => {
          if (!open) clear();
        }}
        sx={{
          position: 'fixed',
          top: 0,
          bottom: 0,
          left: 0,
          width: 8,
          zIndex: (theme) => theme.zIndex.drawer,
        }}
      />
      <Slide direction="right" in={open} mountOnEnter unmountOnExit>
        <Paper
          component="aside"
          aria-label={t('nav.peekMenu')}
          elevation={8}
          square
          sx={{
            position: 'fixed',
            top: 0,
            bottom: 0,
            left: 0,
            width,
            zIndex: (theme) => theme.zIndex.drawer + 1,
            display: 'flex',
            flexDirection: 'column',
            borderRight: 1,
            borderColor: 'divider',
          }}
        >
          {children}
        </Paper>
      </Slide>
    </>
  );
}
