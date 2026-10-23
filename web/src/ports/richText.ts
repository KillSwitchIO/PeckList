import type { ComponentType } from 'react';

export interface RichTextEditorProps {
  /** The stored text, as markdown. */
  value: string;
  /**
   * Called with the edited markdown when editing pauses (on blur). Not called when nothing
   * changed, so text that was never touched keeps its exact stored form.
   */
  onCommit: (markdown: string) => void;
  /** Accessible name of the editing area. */
  label: string;
  /** Shown while the text is empty. */
  placeholder?: string;
  /** Show the text without letting it change. */
  readOnly?: boolean;
  /**
   * The full editor (a dialog): formatting toolbar and room to write. Otherwise the text sits
   * inline, always editable, with no toolbar and no change of size on focus.
   */
  expanded?: boolean;
}

/**
 * An editor for markdown text that formats as you type. Swap the library behind it by adding an
 * adapter that passes `adapters/richText.contract.tsx`.
 */
export type RichTextEditor = ComponentType<RichTextEditorProps>;
