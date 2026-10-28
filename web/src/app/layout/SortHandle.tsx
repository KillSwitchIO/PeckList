import { DragHandleIcon } from '../icons/icons.tsx';

/**
 * The grip a row is dragged by while editing the sidebar or the bottom bar (R-FB-113): only it
 * moves the row, so a swipe anywhere else scrolls. A finger-sized target round a small icon.
 */
export function SortHandle() {
  return (
    <DragHandleIcon
      data-drag-handle=""
      fontSize="small"
      sx={{
        color: 'text.disabled',
        boxSizing: 'content-box',
        p: 1,
        ml: -2,
        mr: -0.5,
        my: -1,
        cursor: 'grab',
        touchAction: 'none',
      }}
    />
  );
}
