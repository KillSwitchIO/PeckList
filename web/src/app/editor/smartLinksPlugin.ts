// Smart links in the notes editor (PL-146): web and email addresses, phone numbers and street
// addresses found in the text are shown as links. They are decorations, not marks, so the note's
// markdown stays exactly as typed, and they follow the text as it is edited. Code, and text that
// is already a link, are left alone.

import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { findSmartLinks, type SmartKind } from '../../core/smartLinks.ts';
import { t } from '../i18n/i18n.ts';

/** What a decoration carries: the kind and the found text. */
export interface SmartSpec {
  kind: SmartKind;
  text: string;
}

export const smartLinksKey = new PluginKey<DecorationSet>('smartLinks');

/** Stands in for text no item may take or cross: code, links, and non-text inline nodes. */
const BLOCKED = '\u0000';

function decorate(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((block, blockPos) => {
    if (!block.isTextblock) return true;
    if (block.type.spec.code) return false;
    // The block's text, one character per position, so an offset maps straight to a position.
    let text = '';
    block.forEach((child) => {
      const skip =
        !child.isText ||
        child.marks.some((mark) => mark.type.spec.code || mark.type.name === 'link');
      text += skip ? BLOCKED.repeat(child.nodeSize) : child.text!;
    });
    const start = blockPos + 1;
    for (const item of findSmartLinks(text)) {
      decorations.push(
        Decoration.inline(
          start + item.from,
          start + item.to,
          { class: 'smart-link', 'data-smart': item.kind },
          { kind: item.kind, text: item.text } satisfies SmartSpec,
        ),
      );
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

/** What a smart item is called out loud: its kind and its text ("Phone number: 515-555-0123"). */
export function smartItemName(item: SmartSpec): string {
  return t('smartLinks.item', { kind: t(`smartLinks.kind.${item.kind}`), text: item.text });
}

/**
 * In notes that cannot be edited there is no cursor to move onto an item, so each is a button the
 * keyboard can reach (Tab) and a screen reader names; Enter or Space offers its choices
 * (TiptapEditor). Notes being edited keep plain spans: a tab stop inside a text box would trap Tab.
 */
const asButtons = new WeakMap<DecorationSet, DecorationSet>();

function buttons(set: DecorationSet, doc: PMNode): DecorationSet {
  let made = asButtons.get(set);
  if (!made) {
    made = DecorationSet.create(
      doc,
      set.find().flatMap((each) => {
        const spec = each.spec as SmartSpec;
        // An inline decoration is drawn once per text node, so an item with bold in it would be
        // several buttons. Only its first piece is the button, named for the whole item; the rest
        // look the same and are left out of what a screen reader reads, as the name covers them.
        const firstEnd = firstTextEnd(doc, each.from, each.to);
        const plain = { class: 'smart-link', 'data-smart': spec.kind };
        const pieces = [
          Decoration.inline(
            each.from,
            firstEnd,
            {
              ...plain,
              role: 'button',
              tabindex: '0',
              'aria-haspopup': 'menu',
              'aria-label': smartItemName(spec),
            },
            spec,
          ),
        ];
        if (firstEnd < each.to) {
          pieces.push(
            Decoration.inline(firstEnd, each.to, { ...plain, 'aria-hidden': 'true' }, spec),
          );
        }
        return pieces;
      }),
    );
    asButtons.set(set, made);
  }
  return made;
}

/** Where the first text node from `from` ends, within `to`. */
function firstTextEnd(doc: PMNode, from: number, to: number): number {
  let end = to;
  let found = false;
  doc.nodesBetween(from, to, (node, pos) => {
    if (found) return false;
    if (!node.isText) return true;
    found = true;
    end = Math.min(to, pos + node.nodeSize);
    return false;
  });
  return end;
}

/** The smart item at a position in the document, if there is one. */
export function smartItemAt(
  state: EditorState,
  pos: number,
): (SmartSpec & { from: number; to: number }) | null {
  // find(pos, pos) is what contains pos: either end of an item counts, one place outside does not.
  const hit = smartLinksKey.getState(state)?.find(pos, pos)[0];
  if (!hit) return null;
  const spec = hit.spec as SmartSpec;
  return { kind: spec.kind, text: spec.text, from: hit.from, to: hit.to };
}

export const SmartLinks = Extension.create({
  name: 'smartLinks',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin<DecorationSet>({
        key: smartLinksKey,
        state: {
          init: (_config, state) => decorate(state.doc),
          apply: (tr, set) => (tr.docChanged ? decorate(tr.doc) : set),
        },
        props: {
          decorations: (state) => {
            const set = smartLinksKey.getState(state);
            return set && !editor.isEditable ? buttons(set, state.doc) : set;
          },
        },
      }),
    ];
  },
});
