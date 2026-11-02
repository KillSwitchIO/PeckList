import { darken, lighten, type Theme } from '@mui/material/styles';
import type { BirdColors } from './checkOff.ts';

/** The bird in the theme's accent, as the app icon has it. */
export function birdColors(theme: Theme): BirdColors {
  const accent = theme.palette.primary.main;
  return {
    facets: [
      accent,
      darken(accent, 0.15),
      lighten(accent, 0.15),
      darken(accent, 0.28),
      lighten(accent, 0.3),
      darken(accent, 0.06),
    ],
    edge: theme.palette.background.paper,
    beak: '#e8a33d',
    eye: '#ffffff',
    tick: theme.palette.text.disabled,
    onTick: theme.palette.background.paper,
    strike: theme.palette.text.disabled,
  };
}
