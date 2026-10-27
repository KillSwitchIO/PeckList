// The light outline a row that can be dragged gets under the mouse (R-FB-88, R-FB-89), so it is
// clear which row a press on its handle would move. Drawn inside the row: nothing shifts.

import { alpha, type Theme } from '@mui/material/styles';

export function hoverOutline(theme: Theme): string {
  return `inset 0 0 0 1px ${alpha(theme.palette.text.primary, 0.22)}`;
}
