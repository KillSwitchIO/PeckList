import { useTheme } from '@mui/material/styles';
import { useCallback } from 'react';
import { eventInk } from '../../core/calendarEvents.ts';

/** A calendar's colour as this theme draws it: readable on the page in light and dark. */
export function useEventInk(): (color: string | null) => string {
  const surface = useTheme().palette.background.default;
  return useCallback((color: string | null) => eventInk(color, surface), [surface]);
}
