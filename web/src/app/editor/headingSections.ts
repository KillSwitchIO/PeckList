// A handle at the right of each heading in the notes (Ben, 2026-11-02): press it and move up or
// down to move the heading with everything under it (its section: the blocks down to the next
// heading of its level or higher) somewhere else. A section can go before any heading of its
// level or higher, or at the end of the notes, so two top-level sections swap with their
// subsections, and a subsection moves within its section or into another one.

import { Extension } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { followReorder } from '../dnd/followReorder.ts';

/** A top-level heading: where it starts, its level, and where its section ends. */
export interface Section {
  pos: number;
  level: number;
  end: number;
}

/** The top-level headings of the notes, each with the end of its section. */
export function sectionsOf(doc: Node): Section[] {
  const headings: { pos: number; level: number }[] = [];
  doc.forEach((block, offset) => {
    if (block.type.name === 'heading')
      headings.push({ pos: offset, level: Number(block.attrs.level) });
  });
  return headings.map((heading, index) => {
    const next = headings.slice(index + 1).find((later) => later.level <= heading.level);
    return { ...heading, end: next?.pos ?? doc.content.size };
  });
}

/**
 * Where the section of the heading at `pos` may go: before each heading of its level or higher
 * outside it, and the end of the notes.
 */
export function sectionTargets(doc: Node, pos: number): number[] {
  const sections = sectionsOf(doc);
  const moving = sections.find((section) => section.pos === pos);
  if (!moving) return [];
  return [
    ...sections
      .filter((section) => section.level <= moving.level)
      .filter((section) => section.pos < moving.pos || section.pos >= moving.end)
      .map((section) => section.pos),
    doc.content.size,
  ];
}

/** Move the section of the heading at `pos` to `target` (a spot from sectionTargets). */
export function moveSection(state: EditorState, pos: number, target: number): Transaction | null {
  const moving = sectionsOf(state.doc).find((section) => section.pos === pos);
  if (!moving || !sectionTargets(state.doc, pos).includes(target)) return null;
  // Where it already is: just before it, or just after it.
  if (target === moving.pos || target === moving.end) return null;
  const slice = state.doc.slice(moving.pos, moving.end);
  const tr = state.tr.delete(moving.pos, moving.end);
  tr.insert(tr.mapping.map(target), slice.content);
  return tr.scrollIntoView();
}

const DOTS =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor">' +
  '<circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/>' +
  '<circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/>' +
  '</svg>';

/** The handles, as an editor extension; `label` names one for screen readers. */
export function headingSections(label: string, color: string) {
  return Extension.create({
    name: 'headingSections',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey('headingSections'),
          props: {
            decorations: (state) => {
              const widgets: Decoration[] = [];
              state.doc.forEach((block, offset) => {
                if (block.type.name !== 'heading') return;
                widgets.push(
                  Decoration.widget(
                    offset + 1,
                    (view) => {
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
                        const doc = view.state.doc;
                        const targets = sectionTargets(doc, offset);
                        const heading = view.nodeDOM(offset);
                        if (!(heading instanceof HTMLElement) || targets.length < 2) return;
                        // The headings it can go before, in order, with itself among them; the
                        // end of the notes is the slot after the last.
                        const spots = [...targets.slice(0, -1), offset].sort((a, b) => a - b);
                        const rows = spots
                          .map((spot) => view.nodeDOM(spot))
                          .filter((row): row is HTMLElement => row instanceof HTMLElement);
                        if (rows.length !== spots.length) return;
                        const from = spots.indexOf(offset);
                        const others = spots.filter((spot) => spot !== offset);
                        followReorder(
                          event,
                          rows,
                          from,
                          (to) => {
                            const target = others[to] ?? doc.content.size;
                            const tr = moveSection(view.state, offset, target);
                            if (tr) view.dispatch(tr);
                          },
                          color,
                          view.dom,
                        );
                      });
                      return handle;
                    },
                    {
                      side: -1,
                      ignoreSelection: true,
                      stopEvent: () => true,
                      key: `heading-${offset}`,
                    },
                  ),
                );
              });
              return DecorationSet.create(state.doc, widgets);
            },
          },
        }),
      ];
    },
  });
}
