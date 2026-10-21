import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import { getEntity, maxHlc } from './collections.ts';
import { addDays, datePart, daysBetween, timePart, todayIn } from './dates.ts';
import { inboxList } from './lists.ts';
import { members } from './ops.ts';
import { COLOR_FAMILIES } from './palette.ts';
import { completedTagTasks, openTagCounts, tagTasks } from './queries.ts';
import {
  createTag,
  deleteTag,
  findTagByName,
  isUnder,
  leafName,
  normalizeTagName,
  parentTagPath,
  suggestTagColor,
  tagAncestry,
  tagsOfTask,
  tagTree,
  updateTag,
  visibleTags,
} from './tags.ts';
import { createTask, setTaskStatus, setTaskTag } from './tasks.ts';
import { revertChange } from './undo.ts';
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
    // Names are stored lowercase.
    expect(visibleTags(other.workspace).map((tag) => tag.name)).toEqual(['errands', 'work']);
    expect(normalizeTagName('Home/Front Yard')).toBe('home/front-yard');
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

const PASTEL = COLOR_FAMILIES[0]!.colors.map((color) => color.hex);
const VIVID = COLOR_FAMILIES[4]!.colors.map((color) => color.hex);

describe('nested tags', () => {
  const names = (ws: Parameters<typeof visibleTags>[0]) => visibleTags(ws).map((tag) => tag.name);

  it('creates missing parents, each with its own suggested color', () => {
    const ctx = testContext();
    const { workspace, tag } = createTag(ctx, createWorkspace(ctx), 'home/yard/edge', '#A8DCC0');
    expect(tag.name).toBe('home/yard/edge');
    expect(names(workspace)).toEqual(['home', 'home/yard', 'home/yard/edge']);
    expect(visibleTags(workspace).map((t) => t.color)).toEqual([PASTEL[0], PASTEL[1], '#A8DCC0']);
    expect(parentTagPath('home/yard/edge')).toBe('home/yard');
    expect(parentTagPath('home')).toBe('');
    expect(leafName(tag.name)).toBe('edge');
    expect(isUnder('home/yard', 'HOME')).toBe(true);
    expect(isUnder('homework', 'home')).toBe(false);
  });

  it('suggests a color no tag has; nested tags take the next ones in the parent family', () => {
    const ctx = testContext();
    let ws = createWorkspace(ctx);
    const add = (name: string, color?: string) => {
      ws = createTag(ctx, ws, name, color).workspace;
      return findTagByName(ws, name)!.color;
    };
    // ROYGBIV: home R, home/test O, home/test2 Y.
    expect(add('home')).toBe(PASTEL[0]);
    expect(add('home/test')).toBe(PASTEL[1]);
    expect(add('home/test2')).toBe(PASTEL[2]);
    // Top level: the first color nobody has.
    expect(add('work')).toBe(PASTEL[3]);
    // A child of `work` (pastel 4) takes the next free one after it.
    expect(add('work/meetings')).toBe(PASTEL[4]);
    // Parent in another family: children follow that family, wrapping around its end.
    expect(add('garden', VIVID[8])).toBe(VIVID[8]);
    expect(add('garden/beds')).toBe(VIVID[0]);
    // Parent with a custom color: skip the family logic, first unused color.
    expect(add('cars', '#123456')).toBe('#123456');
    expect(add('cars/oil')).toBe(PASTEL[5]);
    expect(suggestTagColor(ws, 'new', [PASTEL[6]!])).toBe(PASTEL[7]);
  });

  it('moves nested tags with a rename and refuses taken names or self-nesting', () => {
    const ctx = testContext();
    let ws = createTag(ctx, createWorkspace(ctx), 'home/yard', '#A8DCC0').workspace;
    ws = createTag(ctx, ws, 'errands', '#F2A7B5').workspace;
    const home = findTagByName(ws, 'home')!;
    ws = updateTag(ctx, ws, home.id, { name: 'house' });
    expect(names(ws)).toEqual(['errands', 'house', 'house/yard']);
    expect(() => updateTag(ctx, ws, home.id, { name: 'Errands' })).toThrow('taken');
    expect(() => updateTag(ctx, ws, home.id, { name: 'house/yard/deep' })).toThrow('itself');
    // Moving under another tag by path creates nothing new when the parent exists.
    ws = updateTag(ctx, ws, home.id, { name: 'errands/house' });
    expect(names(ws)).toEqual(['errands', 'errands/house', 'errands/house/yard']);
    // Same name only recolors.
    const recolored = updateTag(ctx, ws, home.id, { name: 'errands/house', color: '#F7C59F' });
    expect(findTagByName(recolored, 'errands/house')?.color).toBe('#F7C59F');
    expect(updateTag(ctx, recolored, home.id, {})).toBe(recolored);
  });

  it('deletes nested tags too, and undo brings them all back', () => {
    const ctx = testContext();
    const base = createWorkspace(ctx);
    let ws = createTag(ctx, base, 'home/yard', '#A8DCC0').workspace;
    const yard = findTagByName(ws, 'home/yard')!;
    const home = findTagByName(ws, 'home')!;
    const created = createTask(ctx, ws, {
      title: 't',
      listId: inboxList(base).id,
      tags: [yard.id],
    });
    ws = created.workspace;
    const deleted = deleteTag(ctx, ws, home.id);
    expect(visibleTags(deleted)).toEqual([]);
    expect(members(getEntity(deleted, 'tasks', created.task.id)!.tags)).toEqual([]);
    const undone = revertChange(ctx, ws, deleted, deleted);
    expect(names(undone)).toEqual(['home', 'home/yard']);
    expect(members(getEntity(undone, 'tasks', created.task.id)!.tags)).toEqual([yard.id]);
  });

  it('builds a tree, hanging orphans off the nearest existing parent', () => {
    const ctx = testContext();
    let ws = createTag(ctx, createWorkspace(ctx), 'work/meetings/weekly', '#A7C7E7').workspace;
    ws = createTag(ctx, ws, 'home/yard', '#A8DCC0').workspace;
    ws = createTag(ctx, ws, 'home/attic', '#A8DCC0').workspace;
    // Simulate an import that has `work/meetings` but no `work`.
    const work = findTagByName(ws, 'work')!;
    ws = {
      ...ws,
      entities: { ...ws.entities, tags: ws.entities.tags.filter((tag) => tag.id !== work.id) },
    };
    const tree = tagTree(ws).map(
      (node) => `${'  '.repeat(node.depth)}${node.tag.name}${node.hasChildren ? '/' : ''}`,
    );
    // Siblings keep the order they were made in (new tags go last).
    expect(tree).toEqual([
      'work/meetings/',
      '  work/meetings/weekly',
      'home/',
      '  home/yard',
      '  home/attic',
    ]);
  });

  it('filters tasks by tag, nested tags included, and counts them', () => {
    const ctx = testContext();
    const base = createWorkspace(ctx);
    const listId = inboxList(base).id;
    let ws = createTag(ctx, base, 'home/yard', '#A8DCC0').workspace;
    ws = createTag(ctx, ws, 'work', '#A7C7E7').workspace;
    const home = findTagByName(ws, 'home')!;
    const yard = findTagByName(ws, 'home/yard')!;
    const work = findTagByName(ws, 'work')!;
    const add = (title: string, tags: string[]) => {
      const result = createTask(ctx, ws, { title, listId, tags });
      ws = result.workspace;
      return result.task;
    };
    add('mow', [yard.id]);
    const sweep = add('sweep', [home.id]);
    add('report', [work.id]);
    add('untagged', []);
    const done = add('rake', [yard.id]);
    ws = setTaskStatus(ctx, ws, done.id, 'done');

    expect(
      tagTasks(ws, home.id)
        .map((task) => task.title)
        .sort(),
    ).toEqual(['mow', 'sweep']);
    expect(tagTasks(ws, yard.id).map((task) => task.title)).toEqual(['mow']);
    expect(completedTagTasks(ws, home.id).map((task) => task.title)).toEqual(['rake']);
    const counts = openTagCounts(ws);
    expect([counts.get(home.id), counts.get(yard.id), counts.get(work.id)]).toEqual([2, 1, 1]);
    expect(tagsOfTask(ws, getEntity(ws, 'tasks', sweep.id)!).map((tag) => tag.name)).toEqual([
      'home',
    ]);
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
