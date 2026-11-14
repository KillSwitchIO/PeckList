import { Box, ButtonBase, IconButton, Menu, MenuItem, Tooltip } from '@mui/material';
import { useState } from 'react';
import { CloseIcon, HeartIcon } from '../icons/icons.tsx';
import { t } from '../i18n/i18n.ts';
import { useReminderHidden, useSupporter } from './useSupporter.ts';

/**
 * The sidebar's one-line reminder (PL-112), like Immich's: only for people who aren't supporters
 * here, and hideable for 30 days or for good. It shows only once the server has said so, so a
 * failure or an older server shows nothing.
 */
export function SupporterReminder({ onOpen }: { onOpen: () => void }) {
  const { status, supporter } = useSupporter();
  const { hidden, hide } = useReminderHidden();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  if (status === null || supporter || hidden) return null;
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        mx: 1.5,
        mb: 0.5,
        pl: 1,
        borderRadius: 1,
        color: 'text.secondary',
      }}
    >
      <ButtonBase
        onClick={onOpen}
        sx={{
          flexGrow: 1,
          justifyContent: 'flex-start',
          gap: 1,
          py: 0.5,
          borderRadius: 1,
          typography: 'body2',
          '&:hover': { color: 'text.primary' },
        }}
      >
        <HeartIcon sx={{ fontSize: 16 }} />
        {t('support.reminder')}
      </ButtonBase>
      <Tooltip title={t('support.reminder.hide')}>
        <IconButton
          size="small"
          aria-label={t('support.reminder.hide')}
          aria-haspopup="menu"
          onClick={(event) => setMenu(event.currentTarget)}
          sx={{ p: '4px', color: 'text.disabled', '&:hover': { color: 'text.secondary' } }}
        >
          <CloseIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={menu} open={menu !== null} onClose={() => setMenu(null)}>
        <MenuItem
          onClick={() => {
            setMenu(null);
            hide(false);
          }}
        >
          {t('support.reminder.hideMonth')}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenu(null);
            hide(true);
          }}
        >
          {t('support.reminder.hideForGood')}
        </MenuItem>
      </Menu>
    </Box>
  );
}
