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

  it('shows the formatting toolbar while the box has focus', async () => {
    renderThemed(
      <>
        <TiptapEditor label="Notes" value="" onCommit={() => undefined} />
        <button type="button">Elsewhere</button>
      </>,
    );
    expect(screen.queryByRole('toolbar', { name: 'Formatting' })).toBeNull();
    await userEvent.click(await screen.findByRole('textbox', { name: 'Notes' }));
    expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('toolbar', { name: 'Formatting' })).toBeNull();
  });
});
