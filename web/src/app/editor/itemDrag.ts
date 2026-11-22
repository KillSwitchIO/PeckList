// Dragging a list item in the notes by its handle (PL-149): follow the pointer (mouse, pen or
// finger) over the whole notes, show where the item would land, and move it there on release.
// A line between rows shows a place beside items or between blocks (across headings too); an
// indented line under a tinted row shows that the item will nest under that row's item.

import type { EditorView } from '@tiptap/pm/view';
import { ITEMS, moveItemTo, type ItemDrop } from './itemMoves.ts';

/** A row the pointer can be over: an item's own line, or a top-level block that is not a list. */
interface Row {
  box: DOMRect;
  /** The item's position, or the block's index among the top-level blocks */
  item?: number;
  index?: number;
  /** The item's first nested item, when something is nested under it */
  firstNested?: number | undefined;
  /** Where the item's whole element starts on the left (its marker or checkbox included) */
  left: number;
}

/** What the indicator shows, and the drop it stands for. */
export interface DropSpot {
  drop: ItemDrop;
  /** The line: where it is drawn, and whether it is indented (a nest) */
  top: number;
  left: number;
  nest: boolean;
  /** The row a nest goes under, tinted */
  row?: DOMRect;
}

/** How far an item nested under another sits in from it, as the editor's lists are indented. */
const INDENT = 24;

/** The rows of the notes as drawn now (scrolling moves them, so they are asked for each move). */
function rowsOf(view: EditorView): Row[] {
  const rows: Row[] = [];
  view.state.doc.forEach((block, offset, index) => {
    if (!/List$/.test(block.type.name)) {
      const dom = view.nodeDOM(offset);
      if (dom instanceof HTMLElement) {
        const box = dom.getBoundingClientRect();
        rows.push({ box, index, left: box.left });
      }
      return;
    }
    block.descendants((node, inner) => {
      if (!ITEMS.has(node.type.name)) return true;
      const pos = offset + 1 + inner;
      const li = view.nodeDOM(pos);
      // The item's own line is its first paragraph: nested items come after it.
      const line = li instanceof HTMLElement ? li.querySelector('p') : null;
      if (li instanceof HTMLElement && line) {
        const nested = node.childCount > 1 ? node.child(1) : null;
        rows.push({
          box: line.getBoundingClientRect(),
          item: pos,
          firstNested:
            nested && /List$/.test(nested.type.name) && nested.firstChild
              ? pos + 1 + node.firstChild!.nodeSize + 1
              : undefined,
          left: li.getBoundingClientRect().left,
        });
      }
      return true;
    });
  });
  return rows;
}

/**
 * Where an item dragged from `from` would land with the pointer at `y`: over an item's line, its
 * top quarter puts it before that item, its bottom quarter after (or first under it, when items
 * are nested there, which is where that line is drawn), and the middle nests it under that item;
 * over any other block, the half the pointer is in puts it before or after that block. Null over
 * the dragged item itself and what is nested under it.
 */
export function spotAt(view: EditorView, from: number, y: number): DropSpot | null {
  const rows = rowsOf(view);
  if (rows.length === 0) return null;
  const size = view.state.doc.nodeAt(from)?.nodeSize ?? 0;
  const distance = (row: Row) =>
    y < row.box.top ? row.box.top - y : y > row.box.bottom ? y - row.box.bottom : 0;
  const row = rows.reduce((best, each) => (distance(each) < distance(best) ? each : best));
  const { box } = row;
  if (row.item === undefined) {
    const after = y > box.top + box.height / 2;
    return {
      drop: { kind: 'gap', index: row.index! + (after ? 1 : 0) },
      top: after ? box.bottom : box.top,
      left: row.left,
      nest: false,
    };
  }
  if (row.item >= from && row.item < from + size) return null;
  const quarter = box.height / 4;
  if (y < box.top + quarter) {
    return { drop: { kind: 'before', item: row.item }, top: box.top, left: row.left, nest: false };
  }
  if (y > box.bottom - quarter) {
    // Right under this line: first among what is nested here, else after the item.
    if (
      row.firstNested !== undefined &&
      !(row.firstNested >= from && row.firstNested < from + size)
    ) {
      return {
        drop: { kind: 'before', item: row.firstNested },
        top: box.bottom,
        left: row.left + INDENT,
        nest: false,
      };
    }
    return {
      drop: { kind: 'after', item: row.item },
      top: box.bottom,
      left: row.left,
      nest: false,
    };
  }
  return {
    drop: { kind: 'nest', item: row.item },
    top: box.bottom,
    left: row.left + INDENT,
    nest: true,
    row: box,
  };
}

function overlay(styles: Partial<CSSStyleDeclaration>, testId: string): HTMLElement {
  const element = document.createElement('div');
  element.setAttribute('data-testid', testId);
  Object.assign(element.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '2000',
    display: 'none',
    ...styles,
  });
  document.body.appendChild(element);
  return element;
}

/** The nearest scrolling box around the editor (the page, when none is). */
function scrollerOf(element: HTMLElement): HTMLElement {
  for (let at = element.parentElement; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if (/(auto|scroll)/.test(overflowY) && at.scrollHeight > at.clientHeight) return at;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/**
 * Follow the pointer from the handle of the item at `from` until it is let go, showing where the
 * item would land, and move it there; Escape calls it off. Near the top or bottom of the scrolling
 * box the notes scroll, so an item can go to a part of long notes out of sight. `color` is the
 * theme's primary.
 */
export function followItemDrag(
  view: EditorView,
  start: { clientY: number; pointerId: number },
  from: number,
  dragged: HTMLElement,
  color: string,
): void {
  const line = overlay({ height: '2px', borderRadius: '1px', background: color }, 'item-drop-line');
  // A dot at the line's start, as drop lines often have, so a short indented one reads as a place.
  const dot = overlay(
    {
      width: '6px',
      height: '6px',
      borderRadius: '50%',
      border: `2px solid ${color}`,
      background: 'transparent',
    },
    'item-drop-dot',
  );
  const tint = overlay(
    { borderRadius: '4px', background: color, opacity: '0.12' },
    'item-drop-nest',
  );
  const before = dragged.style.opacity;
  dragged.style.opacity = '0.5';
  const scroller = scrollerOf(view.dom);
  const right = () => view.dom.getBoundingClientRect().right;
  // `from` is a position in the notes as they were at the start: a change that arrives meanwhile
  // (a sync) calls the drop off rather than move the wrong item.
  const startDoc = view.state.doc;
  let y = start.clientY;
  let spot: DropSpot | null = null;
  let frame = 0;
  const place = () => {
    spot = spotAt(view, from, y);
    if (!spot) {
      for (const each of [line, dot, tint]) each.style.display = 'none';
      return;
    }
    const width = Math.max(40, right() - spot.left);
    Object.assign(line.style, {
      display: 'block',
      top: `${spot.top - 1}px`,
      left: `${spot.left}px`,
      width: `${width}px`,
    });
    Object.assign(dot.style, {
      display: 'block',
      top: `${spot.top - 5}px`,
      left: `${spot.left - 8}px`,
    });
    if (spot.row) {
      Object.assign(tint.style, {
        display: 'block',
        top: `${spot.row.top - 2}px`,
        left: `${spot.left - INDENT}px`,
        width: `${width + INDENT}px`,
        height: `${spot.row.height + 4}px`,
      });
    } else tint.style.display = 'none';
  };
  // Scroll while the pointer is near the scrolling box's top or bottom edge.
  const edge = 48;
  const tick = () => {
    const box =
      scroller === document.scrollingElement || scroller === document.documentElement
        ? { top: 0, bottom: window.innerHeight }
        : scroller.getBoundingClientRect();
    const step = y < box.top + edge ? -8 : y > box.bottom - edge ? 8 : 0;
    if (step) {
      scroller.scrollBy(0, step);
      place();
    }
    frame = requestAnimationFrame(tick);
  };
  const move = (event: PointerEvent) => {
    if (event.pointerId !== start.pointerId) return;
    event.preventDefault();
    y = event.clientY;
    place();
  };
  const end = (commit: boolean) => {
    cancelAnimationFrame(frame);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', key, true);
    for (const each of [line, dot, tint]) each.remove();
    dragged.style.opacity = before;
    if (!commit || !spot || view.isDestroyed || view.state.doc !== startDoc) return;
    const tr = moveItemTo(view.state, from, spot.drop);
    if (tr) view.dispatch(tr);
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
  place();
  frame = requestAnimationFrame(tick);
}
