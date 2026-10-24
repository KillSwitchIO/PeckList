import { Dialog, Menu, MenuItem } from '@mui/material';
import { render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleBack } from './back.ts';

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '');
});

function DialogWithMenu() {
  const [dialog, setDialog] = useState(true);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <Dialog open={dialog} onClose={() => setDialog(false)}>
      <button onClick={(event) => setAnchor(event.currentTarget)}>Open menu</button>
      <Menu open={anchor !== null} anchorEl={anchor} onClose={() => setAnchor(null)}>
        <MenuItem>Inner</MenuItem>
      </Menu>
    </Dialog>
  );
}

describe('Android Back inside the app', () => {
  it('closes the topmost popup first, then the one under it', async () => {
    render(<DialogWithMenu />);
    screen.getByRole('button', { name: 'Open menu' }).click();
    await screen.findByRole('menuitem', { name: 'Inner' });

    expect(handleBack()).toBe(true);
    await waitFor(() => expect(screen.queryByRole('menuitem')).toBeNull());
    expect(screen.getByText('Open menu')).toBeInTheDocument();

    expect(handleBack()).toBe(true);
    await waitFor(() => expect(screen.queryByText('Open menu')).toBeNull());
  });

  it('steps back while the app has somewhere to go back to, and says no at the start', () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    window.history.replaceState({ idx: 2 }, '');
    expect(handleBack()).toBe(true);
    expect(back).toHaveBeenCalledOnce();

    window.history.replaceState({ idx: 0 }, '');
    expect(handleBack()).toBe(false);
    expect(back).toHaveBeenCalledOnce();
  });
});
