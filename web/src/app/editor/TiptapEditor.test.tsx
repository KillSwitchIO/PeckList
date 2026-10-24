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
