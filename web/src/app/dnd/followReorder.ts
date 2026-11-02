// Reordering by a handle (R-FB-79, R-FB-80): press a row's handle, move up or down, let go. Plain
// DOM, so the same code serves React lists (subtasks) and the notes editor (its list items).

/** A line between rows where the dragged one would go. */
function drawLine(color: string): HTMLElement {
  const line = document.createElement('div');
  line.setAttribute('data-testid', 'reorder-line');
  Object.assign(line.style, {
    position: 'fixed',
    height: '2px',
    borderRadius: '1px',
    background: color,
    pointerEvents: 'none',
    zIndex: '2000',
    display: 'none',
  });
  document.body.appendChild(line);
  return line;
}

/**
 * Where among `rows` (the dragged one left out) a pointer at `y` would put the dragged row: the
 * number of other rows whose middle is above it.
 */
export function slotAt(rows: readonly HTMLElement[], from: number, y: number): number {
  return rows.filter((row, index) => {
    if (index === from) return false;
    const box = row.getBoundingClientRect();
    return box.top + box.height / 2 < y;
  }).length;
}

/**
 * Follow the pointer from a handle on `rows[from]` until it is let go, showing where the row
 * would go; `onDrop` gets its new index among the other rows (as `slotAt`), unless it stays put
 * or Escape calls it off. `color` is the line's (the theme's primary).
 */
export function followReorder(
  start: { clientY: number; pointerId: number },
  rows: readonly HTMLElement[],
  from: number,
  onDrop: (to: number) => void,
  color = '#6c8ebf',
  /** Where the slot after the last row is drawn, when it is not right under the last row. */
  endRow?: HTMLElement,
): void {
  const dragged = rows[from];
  if (!dragged) return;
  const line = drawLine(color);
  const before = dragged.style.opacity;
  dragged.style.opacity = '0.5';
  let to = from;
  const place = (y: number) => {
    to = slotAt(rows, from, y);
    const others = rows.filter((_, index) => index !== from);
    const anchor = others[to];
    const last = others[others.length - 1];
    const box = (anchor ?? endRow ?? last ?? dragged).getBoundingClientRect();
    const top = anchor ? box.top : box.bottom;
    Object.assign(line.style, {
      display: 'block',
      top: `${top - 1}px`,
      left: `${box.left}px`,
      width: `${Math.max(40, box.width)}px`,
    });
  };
  const move = (event: PointerEvent) => {
    if (event.pointerId !== start.pointerId) return;
    event.preventDefault();
    place(event.clientY);
  };
  const end = (commit: boolean) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', key, true);
    line.remove();
    dragged.style.opacity = before;
    if (commit && to !== from) onDrop(to);
  };
  const up = (event: PointerEvent) => {
    if (event.pointerId === start.pointerId) end(true);
  };
  const cancel = () => end(false);
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      end(false);
    }
  };
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', key, true);
  place(start.clientY);
}
