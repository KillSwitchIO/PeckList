import { Box, Button, ListItemText, Menu, MenuItem, Typography } from '@mui/material';
import { useState } from 'react';
import { localDateTimeOf, localTimeZone } from '../../core/dates.ts';
import type { CalendarLinkInfo, CalendarMode } from '../../ports/calendars.ts';
import { formatWhen } from '../format.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { ChevronDownIcon } from '../icons/icons.tsx';
import { modeText, problemText } from './calendarText.ts';
import { useEventInk } from './eventInk.ts';

/**
 * One calendar of an account: its colour, its name, and how it is used, picked from a popover
 * (spec: PL-134 Settings > Calendars: Off, Show events, or Sync with a tag). A line under it says
 * when it last synced, or a problem and when it is tried again.
 */
export function CalendarRow({
  link,
  tagName,
  busy,
  problem,
  onPick,
}: {
  link: CalendarLinkInfo;
  tagName: (id: string) => string | null;
  busy: boolean;
  /** A refusal of the last change made here, in words */
  problem: string | null;
  onPick: (mode: CalendarMode) => void;
}) {
  const today = useToday();
  const ink = useEventInk();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const zone = localTimeZone();
  const when = (instant: string) => formatWhen(localDateTimeOf(instant, zone), today);
  const name = link.name || t('calendars.untitled');
  const choose = (mode: CalendarMode) => {
    setMenu(null);
    if (mode !== link.mode || mode === 'sync') onPick(mode);
  };
  const status = problem
    ? { text: problem, error: true }
    : link.problem && link.mode !== 'off'
      ? {
          text: link.nextAttempt
            ? t('calendars.row.problemRetry', {
                problem: problemText(link.problem),
                when: when(link.nextAttempt),
              })
            : problemText(link.problem),
          error: true,
        }
      : link.mode !== 'off' && link.syncedAt
        ? { text: t('calendars.row.synced', { when: when(link.syncedAt) }), error: false }
        : null;
  return (
    <Box sx={{ py: 0.75 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minHeight: 36 }}>
        <Box
          aria-hidden
          sx={{
            width: 10,
            height: 10,
            borderRadius: '3px',
            flexShrink: 0,
            bgcolor: ink(link.color),
          }}
        />
        <Typography noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
          {name}
          {link.readOnly && (
            <Typography component="span" variant="body2" color="text.secondary">
              {' '}
              {t('calendars.row.readOnly')}
            </Typography>
          )}
        </Typography>
        <Button
          size="small"
          color="inherit"
          disabled={busy}
          aria-haspopup="menu"
          aria-label={t('calendars.row.use', { calendar: name, mode: modeText(link, tagName) })}
          endIcon={<ChevronDownIcon fontSize="small" />}
          onClick={(click) => setMenu(click.currentTarget)}
          // One width class: a long tag name cuts off rather than pushing the row about.
          sx={{
            flexShrink: 0,
            maxWidth: { xs: 150, sm: 200 },
            color: 'text.secondary',
            fontWeight: 400,
            '& .label': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
          }}
        >
          <span className="label">{modeText(link, tagName)}</span>
        </Button>
      </Box>
      {/* Always there, a line high even when empty: Sync now and a problem change its words, and
          nothing under it moves (QA, PL-134). */}
      <Typography
        variant="caption"
        component="div"
        color={status?.error ? 'error' : 'text.secondary'}
        sx={{ pl: 3.25, minHeight: '1.66em' }}
      >
        {status?.text}
      </Typography>
      <Menu
        anchorEl={menu}
        open={menu !== null}
        onClose={() => setMenu(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ list: { 'aria-label': t('calendars.row.useOf', { calendar: name }) } }}
      >
        <MenuItem selected={link.mode === 'off'} onClick={() => choose('off')}>
          <ListItemText primary={t('calendars.mode.off')} secondary={t('calendars.mode.offHint')} />
        </MenuItem>
        <MenuItem selected={link.mode === 'show'} onClick={() => choose('show')}>
          <ListItemText
            primary={t('calendars.mode.show')}
            secondary={t('calendars.mode.showHint')}
          />
        </MenuItem>
        <MenuItem
          selected={link.mode === 'sync'}
          disabled={link.readOnly}
          onClick={() => choose('sync')}
        >
          <ListItemText
            primary={t('calendars.mode.syncTag')}
            secondary={
              link.readOnly ? t('calendars.mode.syncReadOnly') : t('calendars.mode.syncHint')
            }
            slotProps={{ secondary: { sx: { whiteSpace: 'normal', maxWidth: 260 } } }}
          />
        </MenuItem>
      </Menu>
    </Box>
  );
}
