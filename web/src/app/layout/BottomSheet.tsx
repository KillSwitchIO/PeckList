import { Box, SwipeableDrawer } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import type { ReactNode, RefCallback, SyntheticEvent } from 'react';
import { PULL_SETTLE_MS, type PullUp } from '../tasks/usePullUp.ts';
import { POPUP_RADIUS } from '../theme/theme.ts';

/**
 * A panel that slides up from the bottom on phones. It closes by swiping it down (once anything
 * inside is scrolled to its top), by tapping outside it, or with Escape.
 */
export function BottomSheet({
  open,
  onClose,
  label,
  paperSx,
  keepMounted = false,
  grabber = true,
  pull,
  children,
}: {
  open: boolean;
  /** `reason` is "escapeKeyDown" or "backdropClick"; none for a swipe */
  onClose: (event: SyntheticEvent | Event | object, reason?: string) => void;
  /** Names the sheet as a dialog; leave out when what is inside names itself */
  label?: string;
  paperSx?: SxProps<Theme>;
  keepMounted?: boolean;
  /** The small bar on top that shows it can be pulled down */
  grabber?: boolean;
  /** Comes up under the finger instead of sliding in (usePullUp). */
  pull?: PullUp;
  children: ReactNode;
}) {
  const phase = pull?.phase ?? null;
  const moving = phase === 'drag' || phase === 'settle';
  // While dragged it follows the finger, easing only when the browser reports it in steps.
  const glide =
    phase === 'settle' ? `${PULL_SETTLE_MS}ms ease-out` : 'var(--pull-ease, 0ms) linear';
  return (
    <SwipeableDrawer
      anchor="bottom"
      open={open}
      onOpen={() => undefined}
      onClose={onClose as (event: SyntheticEvent) => void}
      disableSwipeToOpen
      disableDiscovery
      {...(pull ? { ref: pull.sheet as RefCallback<HTMLDivElement> } : {})}
      // Under a finger it is already where it should be, so it neither slides in nor out.
      {...(phase ? { transitionDuration: 0 } : {})}
      // On a dialog's level, not a drawer's (below it): a sheet opened from a dialog, such as the
      // date from the expanded task form, must come out on top of it. Among equals, the last opened wins.
      sx={{
        zIndex: (theme) => theme.zIndex.modal,
        ...(moving && {
          '& > .MuiBackdrop-root': {
            opacity: 'var(--pull-share, 0) !important',
            transition: `opacity ${glide} !important`,
          },
        }),
      }}
      // Closed sheets leave the page (MUI keeps a swipeable one mounted by default).
      ModalProps={{
        keepMounted,
        // A finger may still let go and leave it closed: the keyboard and focus stay until it opens.
        // MUI reads the restore setting only as it opens, so a pulled-up panel gives focus back to
        // the page rather than to the bar when it closes.
        ...(moving && {
          disableAutoFocus: true,
          disableEnforceFocus: true,
          disableRestoreFocus: true,
        }),
      }}
      slotProps={{
        paper: {
          ...(label ? { role: 'dialog', 'aria-label': label } : {}),
          sx: [
            {
              borderTopLeftRadius: POPUP_RADIUS,
              borderTopRightRadius: POPUP_RADIUS,
              pb: 'env(safe-area-inset-bottom)',
            },
            ...(moving
              ? [
                  {
                    transform: 'translateY(calc(100% - var(--pull-px, 0px))) !important',
                    transition: `transform ${glide} !important`,
                    '@media (prefers-reduced-motion: reduce)': { transition: 'none !important' },
                  },
                ]
              : []),
            ...(Array.isArray(paperSx) ? paperSx : [paperSx]),
          ],
        },
      }}
    >
      {grabber && (
        <Box
          aria-hidden
          sx={{
            width: 36,
            height: 4,
            borderRadius: 2,
            bgcolor: 'divider',
            mx: 'auto',
            mt: 1,
            mb: 0.5,
            flexShrink: 0,
          }}
        />
      )}
      {children}
    </SwipeableDrawer>
  );
}
