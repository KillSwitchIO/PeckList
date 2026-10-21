import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import { getEntity, maxHlc } from './collections.ts';
import { addDays, datePart, daysBetween, timePart, todayIn } from './dates.ts';
import { inboxList } from './lists.ts';
import { members } from './ops.ts';
import {
  createTag,
  deleteTag,
  findTagByName,
  normalizeTagName,
  tagAncestry,
  updateTag,
  visibleTags,
} from './tags.ts';
import { createTask, setTaskTag } from './tasks.ts';
import { createWorkspace } from './workspace.ts';

describe('tags', () => {
  it('normalizes names into paths', () => {
    expect(normalizeTagName(' home / front yard /')).toBe('home/front-yard');
    expect(tagAncestry('home/yard/edge')).toEqual(['home', 'home/yard', 'home/yard/edge']);
  });

  it('creates once per name (case-insensitive) and sorts by name', () => {
    const ctx = testContext();
    const first = createTag(ctx, createWorkspace(ctx), 'Work', '#A7C7E7');
    const again = createTag(ctx, first.workspace, 'work', '#F2A7B5');
    expect(again.tag.id).toBe(first.tag.id);
    const other = createTag(ctx, again.workspace, 'errands', '#F2A7B5');
    expect(visibleTags(other.workspace).map((tag) => tag.name)).toEqual(['errands', 'Work']);
    expect(findTagByName(other.workspace, 'WORK')?.id).toBe(first.tag.id);
    expect(() => createTag(ctx, other.workspace, ' / ', '#F2A7B5')).toThrow('empty');
  });

  it('renames, recolors and deletes, removing it from tasks', () => {
    const ctx = testContext();
    const ws = createWorkspace(ctx);
    const { workspace, tag } = createTag(ctx, ws, 'home', '#A8DCC0');
    const { workspace: withTask, task } = createTask(ctx, workspace, {
      title: 't',
      listId: inboxList(ws).id,
    });
    let next = setTaskTag(ctx, withTask, task.id, tag.id, true);
    next = updateTag(ctx, next, tag.id, { name: 'house', color: '#F7C59F' });
    expect(getEntity(next, 'tags', tag.id)).toMatchObject({ name: 'house', color: '#F7C59F' });
    next = updateTag(ctx, next, tag.id, { color: '#A8DCC0' });
    next = deleteTag(ctx, next, tag.id);
    expect(visibleTags(next)).toEqual([]);
    expect(members(getEntity(next, 'tasks', task.id)!.tags)).toEqual([]);
  });
});

describe('dates', () => {
  it('computes today in a time zone', () => {
    const late = Date.UTC(2026, 9, 21, 3, 0);
    expect(todayIn('UTC', late)).toBe('2026-10-21');
    expect(todayIn('America/Chicago', late)).toBe('2026-10-20');
  });

  it('splits and shifts dates', () => {
    expect(datePart('2026-10-20T09:30')).toBe('2026-10-20');
    expect(timePart('2026-10-20T09:30')).toBe('09:30');
    expect(timePart('2026-10-20')).toBeNull();
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(daysBetween('2026-10-20', '2026-10-27')).toBe(7);
    expect(daysBetween('2026-10-20', '2026-10-18')).toBe(-2);
    expect(() => addDays('nope', 1)).toThrow('invalid date');
  });
});

describe('maxHlc', () => {
  it('finds the newest timestamp, including element sets', () => {
    const ctx = testContext();
    const ws = createWorkspace(ctx);
    const { workspace, task } = createTask(ctx, ws, { title: 't', listId: inboxList(ws).id });
    const tagged = setTaskTag(ctx, workspace, task.id, 'a', true);
    expect(maxHlc(tagged)).toBe(getEntity(tagged, 'tasks', task.id)!.tags.a!.hlc);
  });
});
