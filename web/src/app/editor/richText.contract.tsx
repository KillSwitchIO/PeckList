// Contract suite every RichTextEditor adapter must pass. Call it from the adapter's own test file.
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { RichTextEditor } from '../../ports/richText.ts';
import { renderThemed } from '../../test/renderApp.tsx';

export function describeRichTextContract(name: string, Editor: RichTextEditor) {
  describe(`RichTextEditor contract: ${name}`, () => {
    function setup(initial: string) {
      const onCommit = vi.fn();
      let setValue: (value: string) => void = () => undefined;
      function Host() {
        const [value, set] = useState(initial);
        setValue = set;
        return (
          <>
            <Editor
              label="Notes"
              placeholder="Add notes"
              value={value}
              onCommit={(markdown) => {
                onCommit(markdown);
                set(markdown);
              }}
            />
            <button type="button">Elsewhere</button>
          </>
        );
      }
      renderThemed(<Host />);
      return { onCommit, setValue: (value: string) => act(() => setValue(value)) };
    }
    const field = () => screen.findByRole('textbox', { name: 'Notes' });

    it('shows the stored markdown formatted', async () => {
      setup('**Posts** and a [guide](https://example.com)');
      const editor = await field();
      expect(editor).toHaveTextContent('Posts and a guide');
      expect(editor.querySelector('strong')).toHaveTextContent('Posts');
      expect(editor.querySelector('a')).toHaveAttribute('href', 'https://example.com');
    });

    it('commits the edited markdown when focus leaves', async () => {
      const { onCommit } = setup('');
      await userEvent.type(await field(), 'Buy posts');
      expect(onCommit).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }));
      expect(onCommit).toHaveBeenCalledExactlyOnceWith('Buy posts');
    });

    it('commits when the page is hidden mid-edit', async () => {
      const { onCommit } = setup('');
      await userEvent.type(await field(), 'Half typed');
      act(() => {
        window.dispatchEvent(new Event('pagehide'));
      });
      expect(onCommit).toHaveBeenCalledExactlyOnceWith('Half typed');
    });

    it('Escape leaves the notes and commits them', async () => {
      const { onCommit } = setup('');
      const editor = await field();
      await userEvent.type(editor, 'Buy posts');
      const escape = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        editor.dispatchEvent(escape);
      });
      expect(editor).not.toHaveFocus();
      expect(onCommit).toHaveBeenCalledExactlyOnceWith('Buy posts');
      // Handled here, so a details panel around it stays open until the next Escape.
      expect(escape.defaultPrevented).toBe(true);
    });

    it('does not commit when nothing changed', async () => {
      const { onCommit } = setup('2 < 3 & snake_case');
      await userEvent.click(await field());
      await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }));
      expect(onCommit).not.toHaveBeenCalled();
    });

    it('formats markdown typed as you go', async () => {
      const { onCommit } = setup('');
      const editor = await field();
      await userEvent.type(editor, '[[ ] posts');
      expect(editor.querySelector('input[type=checkbox]')).not.toBeNull();
      await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }));
      expect(onCommit).toHaveBeenCalledExactlyOnceWith('- [ ] posts');
    });

    it('turns "- [ ] " typed the markdown way into a checklist line', async () => {
      const { onCommit } = setup('');
      const editor = await field();
      await userEvent.type(editor, '- [[x] done');
      expect(editor.querySelector('input[type=checkbox]')).toBeChecked();
      await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }));
      expect(onCommit).toHaveBeenCalledExactlyOnceWith('- [x] done');
    });

    it('read-only shows the text and takes no typing', async () => {
      const onCommit = vi.fn();
      renderThemed(
        <>
          <Editor label="Notes" value="Keep **out**" readOnly onCommit={onCommit} />
          <button type="button">Elsewhere</button>
        </>,
      );
      const editor = await field();
      expect(editor).toHaveTextContent('Keep out');
      expect(editor).toHaveAttribute('aria-readonly', 'true');
      await userEvent.type(editor, 'more');
      await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }));
      expect(editor).toHaveTextContent('Keep out');
      expect(onCommit).not.toHaveBeenCalled();
    });

    it('takes outside changes', async () => {
      const { setValue } = setup('Before');
      const editor = await field();
      setValue('After **undo**');
      expect(editor).toHaveTextContent('After undo');
    });
  });
}
