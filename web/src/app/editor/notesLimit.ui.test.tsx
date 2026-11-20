import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { renderThemed } from '../../test/renderApp.tsx';
import { NotesEditor } from './NotesEditor.tsx';

/** Notes kept the way the store keeps them: cut at the limit. */
function Notes({ max, saved }: { max: number; saved: string[] }) {
  const [value, setValue] = useState('');
  return (
    <>
      <NotesEditor
        label="Notes"
        value={value}
        maxLength={max}
        onCommit={(markdown) => {
          saved.push(markdown.slice(0, max));
          setValue(markdown.slice(0, max));
        }}
      />
      <button type="button">Elsewhere</button>
    </>
  );
}

describe('notes past their limit', () => {
  it('say the rest was not saved, show what was kept, and stop saying so once short again', async () => {
    const saved: string[] = [];
    renderThemed(<Notes max={20} saved={saved} />);
    const notes = await screen.findByRole('textbox', { name: 'Notes' });
    const leave = () => userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }));
    const message = 'Notes keep up to 20 characters. The rest was not saved.';
    // A live region there from the start, so a screen reader reads the message out when it comes.
    const live = document.querySelector('[data-notes-limit]')!;
    expect(live).toHaveAttribute('role', 'status');
    expect(live).toBeEmptyDOMElement();

    await userEvent.type(notes, 'Buy milk and eggs and bread');
    await leave();
    await waitFor(() => expect(live).toHaveTextContent(message));
    expect(document.querySelector('[data-notes-limit]')).toBe(live);
    expect(saved.at(-1)).toBe('Buy milk and eggs an');
    // The editor shows what was kept, not the part that was cut.
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveTextContent(
        /^Buy milk and eggs an$/,
      ),
    );

    // Longer again: the store keeps the same text, and the screen still matches it.
    // At the end, so the cut keeps the same text as before.
    const box = screen.getByRole('textbox', { name: 'Notes' });
    await userEvent.click(box);
    const end = document.createRange();
    end.selectNodeContents(box.querySelector('p')!);
    end.collapse(false);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(end);
    document.dispatchEvent(new Event('selectionchange'));
    await userEvent.keyboard(' and jam');
    expect(box).toHaveTextContent(/an and jam$/);
    await leave();
    expect(live).toHaveTextContent(message);
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Notes' }).textContent).toHaveLength(20),
    );

    // Within the limit: no message.
    await userEvent.clear(screen.getByRole('textbox', { name: 'Notes' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Notes' }), 'Milk');
    await leave();
    await waitFor(() => expect(screen.queryAllByText(message)).toHaveLength(0));
    expect(live).toBeEmptyDOMElement();
    expect(saved.at(-1)).toBe('Milk');
  });
});
