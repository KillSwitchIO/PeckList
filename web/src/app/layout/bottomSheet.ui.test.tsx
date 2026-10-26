import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderThemed } from '../../test/renderApp.tsx';
import { BottomSheet } from './BottomSheet.tsx';

describe('a bottom sheet', () => {
  it('sits on the dialogs layer, so one opened from a dialog shows on top of it', () => {
    renderThemed(
      <BottomSheet open onClose={() => undefined} label="Date">
        <p>Pick a date</p>
      </BottomSheet>,
    );
    const root = screen.getByRole('dialog', { name: 'Date' }).closest('.MuiDrawer-root')!;
    // theme.zIndex.modal; a drawer's own (1200) put it under the expanded task form (a dialog).
    expect(getComputedStyle(root).zIndex).toBe('1300');
  });
});
