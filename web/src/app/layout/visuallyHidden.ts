/**
 * Read out by a screen reader, not shown: `sx` for a status line or label no one sees. The sizes
 * are strings because MUI reads a bare 1 as 100%: a row-wide box poked past a phone's edge,
 * widened the page, and the bottom bar order popup then shifted everything left (Ben, rc.3).
 */
export const visuallyHidden = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  margin: '-1px',
  padding: 0,
  border: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;
