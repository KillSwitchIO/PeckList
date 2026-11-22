// A handle at the right of each bullet, numbered and checklist item in the notes (R-FB-80): press
// it and move it anywhere in the notes (PL-149): beside another item, across headings, into a gap
// between blocks, or onto an item to nest under it. Numbered items number themselves again when
// the notes are written back as markdown.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { claimTouches } from '../dnd/claimTouch.ts';
import { followItemDrag } from './itemDrag.ts';
import { ITEMS } from './itemMoves.ts';

const DOTS =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor">' +
  '<circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/>' +
  '<circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/>' +
  '</svg>';

/** The handles, as an editor extension; `label` names one for screen readers. */
export function listItemHandles(label: string, color: string) {
  return Extension.create({
    name: 'listItemHandles',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey('listItemHandles'),
          props: {
            decorations: (state) => {
              const widgets: Decoration[] = [];
              state.doc.descendants((node, pos) => {
                if (!ITEMS.has(node.type.name)) return true;
                widgets.push(
                  Decoration.widget(
                    pos + 1,
                    (view, getPos) => {
                      const handle = document.createElement('span');
                      handle.className = 'note-item-handle';
                      handle.contentEditable = 'false';
                      handle.setAttribute('role', 'button');
                      handle.setAttribute('aria-label', label);
                      handle.innerHTML = DOTS;
                      // Its touch is the drag's alone: in the task sheet, the sheet does not
                      // swipe on it and the comments do not pull up from it.
                      claimTouches(handle);
                      handle.addEventListener('pointerdown', (event) => {
                        if (event.button !== 0 || !view.editable) return;
                        event.preventDefault();
                        event.stopPropagation();
                        const at = getPos();
                        const li = handle.closest('li');
                        if (at === undefined || !li) return;
                        followItemDrag(view, event, at - 1, li, color);
                      });
                      return handle;
                    },
                    { side: -1, ignoreSelection: true, stopEvent: () => true, key: `item-${pos}` },
                  ),
                );
                return true;
              });
              return DecorationSet.create(state.doc, widgets);
            },
          },
        }),
      ];
    },
  });
}
