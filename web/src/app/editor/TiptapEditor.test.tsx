import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderThemed } from '../../test/renderApp.tsx';
import { describeRichTextContract } from './richText.contract.tsx';
import TiptapEditor from './TiptapEditor.tsx';

describeRichTextContract('TipTap', TiptapEditor);

describe('TipTap notes extras', () => {
  it('turns "/" + a block name into that block', async () => {
    const onCommit = vi.fn();
    renderThemed(
      <>
        <TiptapEditor label="Notes" value="" onCommit={onCommit} />
        <button type="button">Elsewhere</button>
      </>,
    );
    const editor = await screen.findByRole('textbox', { name: 'Notes' });
    await userEvent.type(editor, '/check');
    expect(await screen.findByRole('menuitem', { name: 'Checklist' })).toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('paint');
    await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('- [ ] paint');
  });

  it('"/" + "Every line a checkbox" turns the whole note into boxes, one per line', async () => {
    const onCommit = vi.fn();
    renderThemed(
      <>
        <TiptapEditor label="Notes" value="" onCommit={onCommit} />
        <button type="button">Elsewhere</button>
      </>,
    );
    const editor = await screen.findByRole('textbox', { name: 'Notes' });
    // Two lines in one paragraph (Shift+Enter), then "/" on a line of its own.
    await userEvent.type(
      editor,
      'call the vet{Shift>}{Enter}{/Shift}ask about the shots{Enter}/every',
    );
    expect(
      await screen.findByRole('menuitem', { name: 'Every line a checkbox' }),
    ).toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(
      '- [ ] call the vet\n- [ ] ask about the shots',
    );
  });

  it('the full editor has one button that is "back to lines" while the note is all boxes', async () => {
    const onCommit = vi.fn();
    renderThemed(
      <>
        <TiptapEditor
          label="Notes"
          value={'- [x] bought\n- [ ] not yet'}
          onCommit={onCommit}
          expanded
        />
        <button type="button">Elsewhere</button>
      </>,
    );
    await userEvent.click(await screen.findByRole('textbox', { name: 'Notes' }));
    expect(screen.queryByRole('button', { name: 'Every line a checkbox' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Checkboxes back to lines' }));
    expect(
      await screen.findByRole('button', { name: 'Every line a checkbox' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('bought\n\nnot yet');
  });

  it('has no edit mode inline: no toolbar on focus; the full editor has one', async () => {
    const { unmount } = renderThemed(
      <TiptapEditor label="Notes" value="" onCommit={() => undefined} />,
    );
    await userEvent.click(await screen.findByRole('textbox', { name: 'Notes' }));
    expect(screen.queryByRole('toolbar', { name: 'Formatting' })).toBeNull();
    unmount();
    renderThemed(<TiptapEditor label="Notes" value="" onCommit={() => undefined} expanded />);
    await screen.findByRole('textbox', { name: 'Notes' });
    expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBeInTheDocument();
  });

  it('ticks a checklist box without taking focus, and keeps it at once', async () => {
    const onCommit = vi.fn();
    renderThemed(
      <TiptapEditor label="Notes" value={'- [ ] milk\n- [ ] eggs'} onCommit={onCommit} />,
    );
    const editor = await screen.findByRole('textbox', { name: 'Notes' });
    const boxes = await screen.findAllByRole('checkbox');
    await userEvent.click(boxes[1]!);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('- [ ] milk\n- [x] eggs');
    expect(editor).not.toHaveFocus();
  });
});

describe('list item handles (R-FB-80)', () => {
  it('gives each list item a handle to move it, and none when read only', async () => {
    const { unmount } = renderThemed(
      <TiptapEditor
        label="Notes"
        value={['1. Milk', '2. Eggs', '', '- [ ] Bread'].join('\n')}
        onCommit={() => undefined}
      />,
    );
    const editor = await screen.findByRole('textbox', { name: 'Notes' });
    expect(editor.querySelectorAll('li .note-item-handle')).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: 'Move this item' })).toHaveLength(3);
    unmount();

    renderThemed(<TiptapEditor label="Notes" value="- Milk" readOnly onCommit={() => undefined} />);
    const shown = await screen.findByRole('textbox', { name: 'Notes' });
    expect(shown).toHaveAttribute('contenteditable', 'false');
  });
});
