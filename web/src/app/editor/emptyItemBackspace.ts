// Backspace in an empty list item deletes the item (PL-149, Ben: after deleting checklist items
// the spacing between lines was wrong). The editor's own Backspace lifts an empty item out of its
// list into an empty paragraph, which only a second Backspace removes: stop after one and a blank
// paragraph is left between the lines, with its own margins, and next to the line the editor keeps
// after a list it is saved as `&nbsp;`, so it stays. Here the item goes at once and the cursor
// lands at the end of the line before it (or the start of the one after, at the top of the notes).

import { Extension } from '@tiptap/core';
import { Selection, type EditorState, type Transaction } from '@tiptap/pm/state';

const ITEMS = new Set(['listItem', 'taskItem']);

/**
 * Delete the empty list item the cursor is in, with its list when it was the only item; null
 * when the cursor is not at an empty item with nothing nested under it, or when the item is all
 * there is in the notes (then the editor's own Backspace turns it into a plain line).
 */
export function deleteEmptyItem(state: EditorState): Transaction | null {
  const { selection, doc } = state;
  if (!selection.empty) return null;
  const { $from } = selection;
  if ($from.depth < 2 || $from.parent.content.size > 0) return null;
  const item = $from.node(-1);
  if (!ITEMS.has(item.type.name) || item.childCount !== 1) return null;
  const list = $from.node(-2);
  // The item, or its whole list when nothing else is in it.
  const depth = list.childCount === 1 ? $from.depth - 2 : $from.depth - 1;
  const from = $from.before(depth);
  const to = $from.after(depth);
  if (from === 0 && to === doc.content.size) return null;
  const tr = state.tr.delete(from, to);
  const at = tr.mapping.map(from);
  const back = Selection.findFrom(tr.doc.resolve(at), -1, true);
  tr.setSelection(back ?? Selection.near(tr.doc.resolve(at), 1));
  return tr.scrollIntoView();
}

/** The Backspace above, ahead of the list keymaps. */
export const EmptyItemBackspace = Extension.create({
  name: 'emptyItemBackspace',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const tr = deleteEmptyItem(editor.state);
        if (!tr) return false;
        editor.view.dispatch(tr);
        return true;
      },
    };
  },
});
