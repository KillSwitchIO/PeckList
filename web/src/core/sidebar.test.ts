import { describe, expect, it } from 'vitest';
import {
  defaultSidebar,
  GROUP,
  moveInOrder,
  normalizeSidebar,
  toggleHidden,
  togglePinned,
} from './sidebar.ts';

const VIEWS = ['today', 'inbox', 'upcoming', 'all', 'calendar', 'completed', 'trash'];

describe('sidebar layout', () => {
  it('starts with Completed and Trash in the group', () => {
    const layout = normalizeSidebar(defaultSidebar(), VIEWS);
    expect(layout.order.slice(layout.order.indexOf(GROUP) + 1)).toEqual(['completed', 'trash']);
  });

  it('fits a saved layout to the views that exist', () => {
    const saved = {
      order: ['trash', 'gone', 'today', 'today', GROUP, 'inbox', GROUP],
      hidden: ['gone', 'inbox'],
      groupOpen: true,
    };
    const layout = normalizeSidebar(saved, [...VIEWS, 'filter:x']);
    // Unknown and repeated ids go; new views join just above the group.
    expect(layout.order).toEqual([
      'trash',
      'today',
      'upcoming',
      'all',
      'calendar',
      'completed',
      'filter:x',
      GROUP,
      'inbox',
    ]);
    expect(layout.hidden).toEqual(['inbox']);
    expect(layout.groupOpen).toBe(true);
  });

  it('moves a view, including across the group marker', () => {
    const order = defaultSidebar().order;
    // Into the group: after the marker.
    expect(moveInOrder(order, 'all', order.indexOf(GROUP))).toEqual([
      'today',
      'inbox',
      'upcoming',
      'due',
      'calendar',
      GROUP,
      'all',
      'completed',
      'trash',
    ]);
    expect(moveInOrder(order, 'trash', 0)[0]).toBe('trash');
  });

  it('hides and shows a view', () => {
    const hidden = toggleHidden(defaultSidebar(), 'calendar');
    expect(hidden.hidden).toEqual(['calendar']);
    expect(toggleHidden(hidden, 'calendar').hidden).toEqual([]);
  });

  it('pins lists and tags above the group, keeps them, and never adds them by itself', () => {
    const pinned = togglePinned(normalizeSidebar(defaultSidebar(), VIEWS), 'tag:t1');
    expect(pinned.order.indexOf('tag:t1')).toBe(pinned.order.indexOf(GROUP) - 1);
    // Kept while the tag exists, dropped once it is gone; other pinnables are not added.
    expect(normalizeSidebar(pinned, VIEWS, ['tag:t1', 'list:l1']).order).toContain('tag:t1');
    expect(normalizeSidebar(pinned, VIEWS, ['list:l1']).order).not.toContain('tag:t1');
    expect(normalizeSidebar(pinned, VIEWS, ['list:l1']).order).not.toContain('list:l1');
    expect(togglePinned(pinned, 'tag:t1').order).not.toContain('tag:t1');
  });
});
