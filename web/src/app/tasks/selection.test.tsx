import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { useTaskSelection } from './selection.ts';

function Probe() {
  const { selectedId, open, close } = useTaskSelection();
  return (
    <>
      <p>{selectedId ?? 'none'}</p>
      <button onClick={() => open('a')}>Open a</button>
      <button onClick={() => open('b')}>Open b</button>
      <button onClick={close}>Close</button>
    </>
  );
}

function setup(path = '/today') {
  const router = createMemoryRouter([{ path: '*', element: <Probe /> }], {
    initialEntries: [path],
  });
  render(<RouterProvider router={router} />);
  return router;
}

const click = (name: string) => userEvent.click(screen.getByRole('button', { name }));

describe('task selection and history', () => {
  it('closing goes back over the entry opening added, so a later Back cannot reopen it', async () => {
    const router = setup();
    await click('Open a');
    expect(screen.getByText('a')).toBeInTheDocument();
    await click('Close');
    expect(await screen.findByText('none')).toBeInTheDocument();
    expect(router.state.location.pathname + router.state.location.search).toBe('/today');
    // Back from here leaves the list; it does not land on the task again.
    await act(() => router.navigate(-1));
    expect(screen.getByText('none')).toBeInTheDocument();
  });

  it('switching tasks replaces the entry: one Back closes the details', async () => {
    const router = setup();
    await click('Open a');
    await click('Open b');
    expect(screen.getByText('b')).toBeInTheDocument();
    await act(() => router.navigate(-1));
    expect(screen.getByText('none')).toBeInTheDocument();
    expect(router.state.location.search).toBe('');
  });

  it('a task opened by its address closes in place', async () => {
    const router = setup('/today?task=a');
    expect(screen.getByText('a')).toBeInTheDocument();
    await click('Close');
    expect(screen.getByText('none')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/today');
  });
});
