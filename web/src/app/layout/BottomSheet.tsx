import { Box, SwipeableDrawer } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import type { ReactNode, SyntheticEvent } from 'react';
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
  children: ReactNode;
}) {
  return (
    <SwipeableDrawer
      anchor="bottom"
      open={open}
      onOpen={() => undefined}
      onClose={onClose as (event: SyntheticEvent) => void}
      disableSwipeToOpen
      disableDiscovery
      // Closed sheets leave the page (MUI keeps a swipeable one mounted by default).
      ModalProps={{ keepMounted }}
      slotProps={{
        paper: {
          ...(label ? { role: 'dialog', 'aria-label': label } : {}),
          sx: [
            {
              borderTopLeftRadius: POPUP_RADIUS,
              borderTopRightRadius: POPUP_RADIUS,
              pb: 'env(safe-area-inset-bottom)',
            },
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
