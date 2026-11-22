import { useTheme, type SxProps, type Theme } from '@mui/material';
import type { FilterLook } from '../../core/savedFilters.ts';
import { ensureContrast, WCAG_UI } from '../../core/palette.ts';
import { FilterIcon } from '../icons/icons.tsx';
import { ListMark } from '../lists/ListMark.tsx';

/**
 * How a saved filter is marked beside its name (PL-149): the icon picked for it in its color, as
 * a list is; else the filter icon, in its color when it has one.
 */
export function FilterMark({ look, sx }: { look: FilterLook; sx?: SxProps<Theme> }) {
  const theme = useTheme();
  if (look.icon) {
    return (
      <ListMark
        list={{ icon: look.icon, color: look.color ?? theme.palette.text.secondary }}
        sx={[{ mx: '3px' }, ...(Array.isArray(sx) ? sx : [sx])]}
      />
    );
  }
  return (
    <FilterIcon
      sx={[
        look.color
          ? { color: ensureContrast(look.color, theme.palette.background.paper, WCAG_UI) }
          : {},
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    />
  );
}
