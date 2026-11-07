import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import {
  bottomBarOf,
  defaultBottomBar,
  fitBottomBar,
  setBottomBar,
  toggleTab,
} from './bottomBar.ts';
import { createList, deleteList, inboxList, restoreList, updateList } from './lists.ts';
import { createTag, deleteTag } from './tags.ts';
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

  it('holds lists and tags, and only hides one that is gone', () => {
    const ctx = testContext();
    const made = createList(ctx, createWorkspace(ctx), { name: 'Garden', color: '#A7C7E7' });
    const tagged = createTag(ctx, made.workspace, 'home/beds');
    const listTab = `list:${made.list.id}`;
    const tagTab = `tag:${tagged.tag.id}`;
    const ws = setBottomBar(ctx, tagged.workspace, ['today', listTab, tagTab, 'search']);
    expect(bottomBarOf(ws, VIEWS)).toEqual(['today', listTab, tagTab, 'search']);

    const deleted = deleteList(ctx, ws, made.list.id);
    expect(bottomBarOf(deleted, VIEWS)).toEqual(['today', tagTab, 'search']);
    expect(bottomBarOf(restoreList(ctx, deleted, made.list.id), VIEWS)).toContain(listTab);

    const archived = updateList(ctx, ws, made.list.id, { archived: true });
    expect(bottomBarOf(archived, VIEWS)).toEqual(['today', tagTab, 'search']);

    const noTag = deleteTag(ctx, ws, tagged.tag.id);
    expect(bottomBarOf(noTag, VIEWS)).toEqual(['today', listTab, 'search']);
  });

  it('keeps a hidden tab through an edit of the bar, so restoring its list still brings it back', () => {
    const ctx = testContext();
    const made = createList(ctx, createWorkspace(ctx), { name: 'Garden', color: '#A7C7E7' });
    const listTab = `list:${made.list.id}`;
    const ws = setBottomBar(ctx, made.workspace, ['today', listTab, 'inbox', 'calendar']);
    const deleted = deleteList(ctx, ws, made.list.id);
    // The editor only ever sees the tabs shown, and the person adds Search.
    const shown = bottomBarOf(deleted, VIEWS);
    expect(shown).toEqual(['today', 'inbox', 'calendar']);
    const edited = setBottomBar(ctx, deleted, [...shown, 'search']);
    expect(bottomBarOf(edited, VIEWS)).toEqual(['today', 'inbox', 'calendar', 'search']);
    // Back with room for it once a tab is taken out.
    const roomy = setBottomBar(ctx, edited, ['today', 'inbox', 'search']);
    expect(bottomBarOf(restoreList(ctx, roomy, made.list.id), VIEWS)).toEqual([
      'today',
      'inbox',
      'search',
      listTab,
    ]);
  });

  it('an id it cannot place is no tab, nor is the Mess Drawer as a list', () => {
    const ctx = testContext();
    const start = createWorkspace(ctx);
    const inbox = `list:${inboxList(start).id}`;
    const ws = setBottomBar(ctx, start, ['list:nope', 'tag:nope', inbox, 'odd:thing']);
    expect(bottomBarOf(ws, VIEWS)).toEqual([]);
  });
});
