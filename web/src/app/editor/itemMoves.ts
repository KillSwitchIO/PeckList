// Where a list item in the notes can be dropped, and the move itself (PL-149, Ben: drag checklist
// and bullet items up and down across headings; drop one on another to indent it under that one).
// Pure: positions in, a transaction out, so the rules are tested without a pointer.

import type { Node, NodeType } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { canJoin } from '@tiptap/pm/transform';

export const ITEMS = new Set(['listItem', 'taskItem']);
const LISTS = new Set(['bulletList', 'orderedList', 'taskList']);

/**
 * Where a dragged item goes:
 * - `before` / `after`: beside the item at `item`, in its list (taking that list's kind);
 * - `nest`: under the item at `item`, first in what is nested there when that is a list of its
 *   own kind, else first in a list of its own;
 * - `gap`: between top-level blocks, before the `index`th (or at the end when it is past the
 *   last), joining a list of its own kind there or starting one.
 * Its own kind is its list's: bullets and numbers both hold listItem, so items alone don't tell.
 */
export type ItemDrop =
  { kind: 'before' | 'after' | 'nest'; item: number } | { kind: 'gap'; index: number };

const isList = (node: Node | null | undefined): node is Node => !!node && LISTS.has(node.type.name);

/** The kind of item a list holds. */
function itemTypeOf(list: Node): NodeType {
  const { nodes } = list.type.schema;
  return list.type.name === 'taskList' ? nodes.taskItem! : nodes.listItem!;
}

/** `item` as an item of `type`: a checklist item that becomes a bullet loses its tick. */
function asItem(item: Node, type: NodeType): Node {
  if (item.type === type) return item;
  return type.create(
    type.name === 'taskItem' ? { checked: false } : null,
    item.content,
    item.marks,
  );
}

/** Whether a drop changes nothing or would put the item inside itself. */
function goesNowhere(doc: Node, from: number, item: Node, drop: ItemDrop): boolean {
  const end = from + item.nodeSize;
  if (drop.kind === 'gap') return false;
  if (drop.item >= from && drop.item < end) return true;
  const target = doc.nodeAt(drop.item);
  if (!target || !ITEMS.has(target.type.name)) return true;
  return (
    (drop.kind === 'before' && drop.item === end) ||
    (drop.kind === 'after' && drop.item + target.nodeSize === from)
  );
}

/** Where `drop` puts the item, and what goes in there (the item, or a list holding it). */
function insertion(
  doc: Node,
  item: Node,
  list: Node,
  drop: ItemDrop,
): { pos: number; node: Node } | null {
  const wrapped = () => list.type.create(null, item);
  if (drop.kind === 'gap') {
    const count = doc.childCount;
    const index = Math.max(0, Math.min(drop.index, count));
    let at = 0;
    for (let each = 0; each < index; each++) at += doc.child(each).nodeSize;
    const before = index > 0 ? doc.child(index - 1) : null;
    const next = index < count ? doc.child(index) : null;
    // Join a list of the item's own kind on either side; else a list of its own.
    if (isList(before) && before.type === list.type) return { pos: at - 1, node: item };
    if (isList(next) && next.type === list.type) return { pos: at + 1, node: item };
    return { pos: at, node: wrapped() };
  }
  const target = doc.nodeAt(drop.item);
  if (!target) return null;
  if (drop.kind === 'nest') {
    const first = target.firstChild;
    if (!first) return null;
    const under = drop.item + 1 + first.nodeSize;
    const nested = target.childCount > 1 ? target.child(1) : null;
    if (isList(nested) && nested.type === list.type) return { pos: under + 1, node: item };
    return { pos: under, node: wrapped() };
  }
  const parent = doc.resolve(drop.item).parent;
  const node = asItem(item, itemTypeOf(parent));
  return { pos: drop.kind === 'before' ? drop.item : drop.item + target.nodeSize, node };
}

/**
 * Move the list item at `from` to `drop`, with what is nested under it; null when it would stay
 * where it is or go inside itself. A list it leaves empty goes too, and two lists of one kind
 * that it leaves side by side join.
 */
export function moveItemTo(state: EditorState, from: number, drop: ItemDrop): Transaction | null {
  const { doc } = state;
  const item = doc.nodeAt(from);
  if (!item || !ITEMS.has(item.type.name) || goesNowhere(doc, from, item, drop)) return null;
  const list = doc.resolve(from).parent;
  const put = insertion(doc, item, list, drop);
  if (!put) return null;
  const tr = state.tr.insert(put.pos, put.node);
  // Then take it out of where it was (now mapped past the insertion).
  const start = tr.mapping.map(from);
  const $start = tr.doc.resolve(start);
  const alone = $start.parent.childCount === 1;
  const [cutFrom, cutTo] = alone
    ? [$start.before(), $start.after()]
    : [start, start + item.nodeSize];
  tr.delete(cutFrom, cutTo);
  // Where it was: what was before the cut now meets what was after it.
  const seam = cutFrom;
  const $seam = tr.doc.resolve(seam);
  if (
    alone &&
    isList($seam.nodeBefore) &&
    isList($seam.nodeAfter) &&
    $seam.nodeBefore.type === $seam.nodeAfter.type &&
    canJoin(tr.doc, seam)
  ) {
    tr.join(seam);
  }
  return tr.scrollIntoView();
}
