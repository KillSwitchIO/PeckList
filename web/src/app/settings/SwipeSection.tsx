import { Box, Button, MenuItem, TextField } from '@mui/material';
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

const NONE = 'none';
const LOOK = { done: false, pinned: false };

/**
 * Settings > Swipe actions (spec: R-FB-54), like TickTick's: for each side, up to three buttons a
 * short swipe shows, in order from the edge, and what a full swipe does. Kept on this device.
 */
export function SwipeSection() {
  const prefs = useSwipePrefs();
  const changed = JSON.stringify(prefs) !== JSON.stringify(DEFAULT_SWIPES);
  const change = (side: 'right' | 'left', patch: Partial<SwipePrefs['right']>) =>
    setSwipePrefs({ ...prefs, [side]: { ...prefs[side], ...patch } });

  const buttons = (side: 'right' | 'left') => {
    const chosen = prefs[side].buttons;
    // The filled slots, then one empty one to add to (up to three).
    const slots = Math.min(MAX_SWIPE_BUTTONS, chosen.length + 1);
    return (
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        {Array.from({ length: slots }, (_, index) => {
          const value = chosen[index] ?? NONE;
          const label = t('swipe.slot', { n: index + 1 });
          return (
            <TextField
              key={index}
              select
              size="small"
              value={value}
              onChange={(event) => {
                const next = [...chosen];
                if (event.target.value === NONE) next.splice(index, 1);
                else next[index] = event.target.value as SwipeAction;
                change(side, { buttons: next });
              }}
              slotProps={{
                htmlInput: {
                  'aria-label': `${t(side === 'right' ? 'swipe.rightButtons' : 'swipe.leftButtons')}, ${label}`,
                },
              }}
              sx={{ minWidth: 112 }}
            >
              <MenuItem value={NONE}>{t('swipe.none')}</MenuItem>
              {SWIPE_ACTIONS.filter((action) => action === value || !chosen.includes(action)).map(
                (action) => (
                  <MenuItem key={action} value={action}>
                    {swipeLook(action, LOOK).label}
                  </MenuItem>
                ),
              )}
            </TextField>
          );
        })}
      </Box>
    );
  };

  const full = (side: 'right' | 'left') => {
    const label = t(side === 'right' ? 'swipe.rightFull' : 'swipe.leftFull');
    return (
      <SettingRow label={label}>
        <TextField
          select
          size="small"
          value={prefs[side].full ?? NONE}
          onChange={(event) =>
            change(side, {
              full: event.target.value === NONE ? null : (event.target.value as SwipeAction),
            })
          }
          slotProps={{ htmlInput: { 'aria-label': label } }}
          sx={{ minWidth: 112 }}
        >
          <MenuItem value={NONE}>{t('swipe.none')}</MenuItem>
          {SWIPE_ACTIONS.map((action) => (
            <MenuItem key={action} value={action}>
              {swipeLook(action, LOOK).label}
            </MenuItem>
          ))}
        </TextField>
      </SettingRow>
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
      <SettingRow label={t('swipe.rightButtons')}>{buttons('right')}</SettingRow>
      {full('right')}
      <SettingRow label={t('swipe.leftButtons')}>{buttons('left')}</SettingRow>
      {full('left')}
    </Section>
  );
}
