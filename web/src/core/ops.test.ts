import { describe, expect, it } from 'vitest';
import { sampleTask, testContext } from '../test/fixtures.ts';
import { compareHlc } from './hlc.ts';
import { createEntity, members, restore, setElement, softDelete, updateEntity } from './ops.ts';
import type { Tag } from './types.ts';

describe('createEntity', () => {
  it('fills base fields and stamps every field with one HLC', () => {
    const ctx = testContext();
    const tag = createEntity<Tag>(ctx, { name: 'home', color: '#A7C7E7' });
    expect(tag.createdBy).toBe(ctx.userId);
    expect(tag.deletedAt).toBeNull();
    expect(tag.origin).toBe('local');
    const clocks = new Set(Object.values(tag._hlc));
    expect(clocks.size).toBe(1);
    expect(Object.keys(tag._hlc).sort()).toEqual([
      'color',
      'createdAt',
      'createdBy',
      'deletedAt',
      'name',
      'origin',
    ]);
  });

  it('accepts an explicit id', () => {
    const tag = createEntity<Tag>(
      testContext(),
      { name: 'x', color: '#A7C7E7' },
      '01TESTFIXED000000000000001',
    );
    expect(tag.id).toBe('01TESTFIXED000000000000001');
  });
});

describe('updateEntity', () => {
  it('stamps only changed fields with a newer HLC', () => {
    const ctx = testContext();
    const task = sampleTask(ctx, 'L', 'Mow');
    const updated = updateEntity(ctx, task, { title: 'Mow lawn', priority: 0 });
    expect(updated.title).toBe('Mow lawn');
    expect(compareHlc(task._hlc.title, updated._hlc.title)).toBe(-1);
    expect(updated._hlc.priority).toBe(task._hlc.priority);
    expect(task.title).toBe('Mow');
  });

  it('returns the same object when nothing changes', () => {
    const ctx = testContext();
    const task = sampleTask(ctx, 'L', 'Mow');
    expect(updateEntity(ctx, task, { title: 'Mow' })).toBe(task);
  });
});

describe('softDelete and restore', () => {
  it('sets and clears deletedAt, and is idempotent', () => {
    const ctx = testContext();
    const task = sampleTask(ctx, 'L', 'Mow');
    const deleted = softDelete(ctx, task);
    expect(deleted.deletedAt).not.toBeNull();
    expect(softDelete(ctx, deleted)).toBe(deleted);
    const restored = restore(ctx, deleted);
    expect(restored.deletedAt).toBeNull();
    expect(restore(ctx, restored)).toBe(restored);
  });
});

describe('element sets', () => {
  it('adds and removes elements with their own HLC', () => {
    const ctx = testContext();
    let set = setElement(ctx, {}, 'b', true);
    set = setElement(ctx, set, 'a', true);
    expect(members(set)).toEqual(['a', 'b']);
    const same = setElement(ctx, set, 'a', true);
    expect(same).toBe(set);
    set = setElement(ctx, set, 'b', false);
    expect(members(set)).toEqual(['a']);
    expect(set.b?.in).toBe(false);
  });
});
