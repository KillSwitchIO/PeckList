import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderThemed } from '../../test/renderApp.tsx';
import { NotesEditor } from './NotesEditor.tsx';

// The editor's part could not be fetched (a new version deployed, the connection dropped).
vi.mock('./preloadEditor.ts', () => ({
  preloadEditor: () =>
    Promise.reject(
      new TypeError('Failed to fetch dynamically imported module: https://x/assets/Tiptap.js'),
    ),
}));

afterEach(() => vi.restoreAllMocks());

describe('notes whose editor could not be fetched', () => {
  it('still show the notes, say the editor could not load, and offer Reload', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // In act, so React's render after the rejection runs here (the app has no act to wait for).
    await act(async () =>
      renderThemed(<NotesEditor value="Buy paint" label="Notes" onCommit={() => undefined} />),
    );
    expect(
      await screen.findByText('The editor could not load. Your notes are safe; reloading gets it.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Buy paint')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });
});
