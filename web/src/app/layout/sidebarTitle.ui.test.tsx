import { screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { mockViewport, renderApp } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

it('the menu shows the app icon beside the name', async () => {
  await renderApp('/today');
  const title = screen.getAllByText('PeckList').at(0)!.parentElement!;
  expect(within(title).getByText('PeckList')).toBeInTheDocument();
  const icon = title.querySelector('svg');
  expect(icon).not.toBeNull();
  expect(icon).toHaveAttribute('width', '28');
  expect(icon).toHaveAttribute('aria-hidden');
});
