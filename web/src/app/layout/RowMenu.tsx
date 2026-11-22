// The menu of a list or saved filter row in the sidebar and on More (PL-149, Ben: edit or delete one
// without opening it first). Lists and filters work the same, so the sidebar stays one thing:
// - with a mouse, a ⋯ shows in place of the row's count when the row is pointed at or focused,
//   and a right-click opens the menu where it is clicked;
// - while editing the sidebar (a hold or the pencil, on a phone too), the ⋯ is always there;
// - on a touch screen otherwise there is no ⋯ (no clutter): hold a row to edit the sidebar, or use
//   the menu on the list's or filter's own page.

import MoreHorizRounded from '@mui/icons-material/MoreHorizRounded';
import { Box, IconButton, useMediaQuery } from '@mui/material';
import type { RowMenuAt } from './rowMenuHelpers.ts';

/**
 * A row's open-task count and its ⋯. Not editing, with a mouse, they share one place so showing
 * the ⋯ moves nothing; on a touch screen only the count shows. Editing, the ⋯ alone.
 */
export function RowCountAndMenu({
  count,
  editing,
  label,
  expanded,
  onOpen,
}: {
  count: number;
  editing: boolean;
  /** The ⋯'s name, for screen readers: "Actions for Garden" */
  label: string;
  expanded: boolean;
  onOpen: (at: RowMenuAt) => void;
}) {
  const hover = useMediaQuery('(hover: hover)', { noSsr: true });
  const button = (
    <IconButton
      className="row-more"
      size="small"
      edge="end"
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={expanded}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        const box = event.currentTarget.getBoundingClientRect();
        onOpen({ top: box.bottom, left: box.left });
      }}
      sx={{
        color: 'text.secondary',
        ...(editing
          ? {}
          : { position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)' }),
      }}
    >
      <MoreHorizRounded fontSize="small" />
    </IconButton>
  );
  if (editing) return button;
  const shown =
    count > 0 ? (
      <Box
        component="span"
        className="row-count"
        sx={{ typography: 'caption', color: 'text.secondary' }}
      >
        {count}
      </Box>
    ) : null;
  if (!hover) return shown;
  return (
    <Box
      component="span"
      sx={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        minWidth: 28,
        minHeight: 28,
      }}
    >
      {shown}
      {button}
    </Box>
  );
}
