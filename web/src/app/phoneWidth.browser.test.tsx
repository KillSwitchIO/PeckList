// Pages at a phone's width, with real layout (PL-002): jsdom lays nothing out, so only a browser
// shows a page that is wider than the screen and scrolls sideways. The browsers open at 375 by 812
// (vitest.browser.config.ts).
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp } from '../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
});

describe('at a phone’s width', () => {
  it('is a phone’s width', () => {
    expect(window.innerWidth).toBe(375);
  });

  it.each([
    ['/today', 'Today'],
    ['/settings', 'Settings'],
  ])('%s fits the screen, with no sideways scroll', async (path, heading) => {
    await renderApp(path);
    await screen.findAllByText(heading);
    const { scrollWidth, clientWidth } = document.documentElement;
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
});
