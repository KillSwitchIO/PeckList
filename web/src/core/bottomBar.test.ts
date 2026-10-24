import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import {
  bottomBarOf,
  defaultBottomBar,
  fitBottomBar,
  setBottomBar,
  toggleTab,
} from './bottomBar.ts';
import { createWorkspace } from './workspace.ts';

const VIEWS = ['today', 'inbox', 'upcoming', 'due', 'all', 'calendar', 'filter:a'];

describe('bottom bar', () => {
  it('starts with Today, the Mess Drawer, Calendar and Search', () => {
    const ws = createWorkspace(testContext());
    expect(bottomBarOf(ws, VIEWS)).toEqual(defaultBottomBar());
  });

  it('keeps the saved tabs that still exist, once each, at most four', () => {
    expect(
      fitBottomBar(['due', 'filter:gone', 'due', 'search', 'all', 'today', 'inbox'], VIEWS),
    ).toEqual(['due', 'search', 'all', 'today']);
  });

  it('adds a tab at the end while there is room, and takes one out', () => {
    expect(toggleTab(['today'], 'due')).toEqual(['today', 'due']);
    expect(toggleTab(['today', 'due'], 'today')).toEqual(['due']);
    expect(toggleTab(['a', 'b', 'c', 'd'], 'e')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('saves the tabs in the settings', () => {
    const ctx = testContext();
    const ws = setBottomBar(ctx, createWorkspace(ctx), ['upcoming', 'search']);
    expect(bottomBarOf(ws, VIEWS)).toEqual(['upcoming', 'search']);
  });
});
