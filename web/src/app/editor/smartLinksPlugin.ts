// Smart links in the notes editor (PL-146): web and email addresses, phone numbers and street
// addresses found in the text are shown as links. They are decorations, not marks, so the note's
// markdown stays exactly as typed, and they follow the text as it is edited. Code, and text that
// is already a link, are left alone.

import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { findSmartLinks, type SmartKind } from '../../core/smartLinks.ts';

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

/** The smart item at a position in the document, if there is one. */
export function smartItemAt(
  state: EditorState,
  pos: number,
): (SmartSpec & { from: number; to: number }) | null {
  const set = smartLinksKey.getState(state);
  const hit = set?.find(pos, pos + 1)[0] ?? set?.find(pos - 1, pos)[0];
  if (!hit) return null;
  const spec = hit.spec as SmartSpec;
  return { kind: spec.kind, text: spec.text, from: hit.from, to: hit.to };
}

export const SmartLinks = Extension.create({
  name: 'smartLinks',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: smartLinksKey,
        state: {
          init: (_config, state) => decorate(state.doc),
          apply: (tr, set) => (tr.docChanged ? decorate(tr.doc) : set),
        },
        props: {
          decorations: (state) => smartLinksKey.getState(state),
        },
      }),
    ];
  },
});
