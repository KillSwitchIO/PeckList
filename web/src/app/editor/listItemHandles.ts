// A handle at the right of each bullet, numbered and checklist item in the notes (R-FB-80): press
// it and move up or down to put the item somewhere else in its list. Numbered items number
// themselves again when the notes are written back as markdown.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { followReorder } from '../dnd/followReorder.ts';

const ITEMS = new Set(['listItem', 'taskItem']);

/**
 * Move the list item that starts at `itemPos` to index `to` among its siblings (counted without
 * it); null when that is where it already is.
 */
export function moveListItem(state: EditorState, itemPos: number, to: number): Transaction | null {
  const item = state.doc.nodeAt(itemPos);
  if (!item || !ITEMS.has(item.type.name)) return null;
  const $pos = state.doc.resolve(itemPos);
  const list = $pos.parent;
  const index = $pos.index();
  const starts: number[] = [];
  let at = $pos.start();
  list.forEach((child) => {
    starts.push(at);
    at += child.nodeSize;
  });
  const others = starts.filter((_, each) => each !== index);
  if (to === index) return null;
  // Before the sibling now at `to`, or at the end of the list.
  const target = to < others.length ? others[to]! : at;
  const tr = state.tr.delete(itemPos, itemPos + item.nodeSize);
  tr.insert(tr.mapping.map(target), item);
  return tr.scrollIntoView();
}

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
                      handle.addEventListener('pointerdown', (event) => {
                        if (event.button !== 0 || !view.editable) return;
                        event.preventDefault();
                        event.stopPropagation();
                        const at = getPos();
                        const li = handle.closest('li');
                        const rows = li
                          ? [...(li.parentElement?.children ?? [])].filter(
                              (each): each is HTMLElement =>
                                each instanceof HTMLElement && each.tagName === 'LI',
                            )
                          : [];
                        if (at === undefined || !li || rows.length < 2) return;
                        followReorder(
                          event,
                          rows,
                          rows.indexOf(li),
                          (to) => {
                            const tr = moveListItem(view.state, at - 1, to);
                            if (tr) view.dispatch(tr);
                          },
                          color,
                        );
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
