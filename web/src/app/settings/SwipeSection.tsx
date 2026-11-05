import AddRounded from '@mui/icons-material/AddRounded';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import {
  Box,
  Button,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { t } from '../i18n/i18n.ts';
import { swipeLook } from '../tasks/swipeLook.tsx';
import {
  DEFAULT_SWIPES,
  MAX_SWIPE_BUTTONS,
  setSwipePrefs,
  SWIPE_ACTIONS,
  useSwipePrefs,
  type SwipeAction,
  type SwipePrefs,
} from '../tasks/swipePrefs.ts';
import { Section, SettingRow } from './settingsLayout.tsx';

type Side = 'right' | 'left';
const NONE = 'none';
const LOOK = { done: false, pinned: false };
const BUTTON = 60;

const fill = (color: string) =>
  color === 'grey'
    ? { bgcolor: 'grey.600', color: 'common.white' }
    : { bgcolor: `${color}.main`, color: `${color}.contrastText` };

/**
 * A sample task as it looks mid-swipe: the side's buttons showing, in their order from the edge,
 * and the card slid over to make room (or, with no buttons, what a full swipe does).
 */
function Preview({
  side,
  buttons,
  full,
}: {
  side: Side;
  buttons: SwipeAction[];
  full: SwipeAction | null;
}) {
  const shown = buttons.length > 0 ? buttons : full ? [full] : [];
  const width = buttons.length > 0 ? buttons.length * BUTTON : full ? 132 : 0;
  const right = side === 'right';
  return (
    <Paper
      variant="outlined"
      role="img"
      aria-label={t('swipe.previewOf', {
        side: t(right ? 'swipe.rightTitle' : 'swipe.leftTitle'),
        actions: shown.map((each) => swipeLook(each, LOOK).label).join(', ') || t('swipe.none'),
      })}
      sx={{ position: 'relative', height: 56, overflow: 'hidden', borderRadius: 2, my: 1 }}
    >
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          justifyContent: right ? 'flex-start' : 'flex-end',
          bgcolor: 'action.selected',
        }}
      >
        {buttons.length > 0
          ? buttons.map((action) => {
              const look = swipeLook(action, LOOK);
              return (
                <Box
                  key={action}
                  sx={{
                    width: BUTTON,
                    display: 'grid',
                    placeItems: 'center',
                    alignContent: 'center',
                    fontSize: 11,
                    gap: 0.25,
                    ...fill(look.color),
                  }}
                >
                  {look.icon}
                  {look.label}
                </Box>
              );
            })
          : full && (
              <Box
                sx={{
                  width,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: right ? 'flex-start' : 'flex-end',
                  gap: 1,
                  px: 2,
                  fontSize: 13,
                  fontWeight: 600,
                  ...fill(swipeLook(full, LOOK).color),
                }}
              >
                {swipeLook(full, LOOK).icon}
                {swipeLook(full, LOOK).label}
              </Box>
            )}
      </Box>
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          width: '100%',
          left: right ? width : -width,
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          px: 2,
          bgcolor: 'background.paper',
          borderLeft: right ? 1 : 0,
          borderRight: right ? 0 : 1,
          borderColor: 'divider',
        }}
      >
        <Box
          sx={{
            width: 16,
            height: 16,
            borderRadius: '4px',
            border: 1.5,
            borderColor: 'text.secondary',
          }}
        />
        <Typography noWrap sx={{ flexGrow: 1 }}>
          {t('swipe.sampleTask')}
        </Typography>
        <Typography variant="body2" color="primary.main" sx={{ flexShrink: 0 }}>
          {t('date.today')}
        </Typography>
      </Box>
    </Paper>
  );
}

/**
 * Settings > Swipe actions (spec: R-FB-54, R-FB-64), like TickTick's: for each side, a sample task
 * showing its buttons as a swipe reveals them, the buttons in order (move them up or down, take
 * one away, add another, up to three), and what a full swipe does. Kept on this device.
 */
export function SwipeSection() {
  const prefs = useSwipePrefs();
  const changed = JSON.stringify(prefs) !== JSON.stringify(DEFAULT_SWIPES);
  const [adding, setAdding] = useState<{ side: Side; anchor: HTMLElement } | null>(null);
  const change = (side: Side, patch: Partial<SwipePrefs['right']>) =>
    setSwipePrefs({ ...prefs, [side]: { ...prefs[side], ...patch } });
  const move = (side: Side, index: number, by: -1 | 1) => {
    const next = [...prefs[side].buttons];
    const [moved] = next.splice(index, 1);
    next.splice(index + by, 0, moved!);
    change(side, { buttons: next });
  };

  const sideBlock = (side: Side) => {
    const title = t(side === 'right' ? 'swipe.rightTitle' : 'swipe.leftTitle');
    const { buttons, full } = prefs[side];
    const fullLabel = t(side === 'right' ? 'swipe.rightFull' : 'swipe.leftFull');
    return (
      <Box component="section" aria-label={title} sx={{ pt: 1, pb: 2 }}>
        <Typography sx={{ fontWeight: 600 }}>{title}</Typography>
        <Preview side={side} buttons={buttons} full={full} />
        <Typography variant="caption" color="text.secondary">
          {t('swipe.buttonsHint')}
        </Typography>
        <Box
          role="list"
          aria-label={t(side === 'right' ? 'swipe.rightButtons' : 'swipe.leftButtons')}
        >
          {buttons.map((action, index) => {
            const look = swipeLook(action, LOOK);
            return (
              <Box
                key={action}
                role="listitem"
                sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}
              >
                <Box
                  sx={{
                    width: 28,
                    height: 28,
                    borderRadius: 1,
                    display: 'grid',
                    placeItems: 'center',
                    '& svg': { fontSize: 18 },
                    ...fill(look.color),
                  }}
                >
                  {look.icon}
                </Box>
                <Typography sx={{ flexGrow: 1 }}>{look.label}</Typography>
                <Tooltip title={t('swipe.moveLeft')}>
                  <span>
                    <IconButton
                      size="small"
                      aria-label={t('swipe.moveLeftNamed', { name: look.label })}
                      disabled={index === 0}
                      onClick={() => move(side, index, -1)}
                    >
                      <ArrowBackRounded fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title={t('swipe.moveRight')}>
                  <span>
                    <IconButton
                      size="small"
                      aria-label={t('swipe.moveRightNamed', { name: look.label })}
                      disabled={index === buttons.length - 1}
                      onClick={() => move(side, index, 1)}
                    >
                      <ArrowForwardRounded fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title={t('swipe.removeButton')}>
                  <IconButton
                    size="small"
                    aria-label={t('swipe.removeNamed', { name: look.label })}
                    onClick={() =>
                      change(side, { buttons: buttons.filter((each) => each !== action) })
                    }
                  >
                    <CloseRounded fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            );
          })}
        </Box>
        {buttons.length < MAX_SWIPE_BUTTONS && (
          <Button
            size="small"
            startIcon={<AddRounded />}
            onClick={(event) => setAdding({ side, anchor: event.currentTarget })}
            sx={{ mt: 0.5 }}
          >
            {t('swipe.addButton')}
          </Button>
        )}
        <SettingRow label={fullLabel} hint={t('swipe.fullHint')}>
          <TextField
            select
            size="small"
            value={full ?? NONE}
            onChange={(event) =>
              change(side, {
                full: event.target.value === NONE ? null : (event.target.value as SwipeAction),
              })
            }
            slotProps={{ htmlInput: { 'aria-label': fullLabel } }}
            sx={{ minWidth: 140 }}
          >
            <MenuItem value={NONE}>{t('swipe.none')}</MenuItem>
            {SWIPE_ACTIONS.map((action) => (
              <MenuItem key={action} value={action}>
                {swipeLook(action, LOOK).label}
              </MenuItem>
            ))}
          </TextField>
        </SettingRow>
      </Box>
    );
  };

  return (
    <Section
      title={t('swipe.title')}
      hint={t('swipe.hint')}
      action={
        <Button size="small" disabled={!changed} onClick={() => setSwipePrefs(null)}>
          {t('swipe.reset')}
        </Button>
      }
    >
      {sideBlock('right')}
      {sideBlock('left')}
      <Menu anchorEl={adding?.anchor} open={adding !== null} onClose={() => setAdding(null)}>
        {adding &&
          SWIPE_ACTIONS.filter((action) => !prefs[adding.side].buttons.includes(action)).map(
            (action) => (
              <MenuItem
                key={action}
                onClick={() => {
                  change(adding.side, { buttons: [...prefs[adding.side].buttons, action] });
                  setAdding(null);
                }}
              >
                {swipeLook(action, LOOK).label}
              </MenuItem>
            ),
          )}
      </Menu>
    </Section>
  );
}
