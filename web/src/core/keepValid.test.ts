import { describe, expect, it } from 'vitest';
import { createAjvValidator } from '../adapters/ajv-validator.ts';
import { testContext } from '../test/fixtures.ts';
import { putEntity } from './collections.ts';
import { keepValid } from './keepValid.ts';
import { createList } from './lists.ts';
import type { List } from './types.ts';
import { createWorkspace } from './workspace.ts';

const validator = createAjvValidator();
const validate = (document: unknown) => validator.validate(document);

function world() {
  const ctx = testContext();
  const made = createList(ctx, createWorkspace(ctx), { name: 'Garden', color: '#CFE3A3' });
  return { ctx, workspace: made.workspace, list: made.list };
}

/** A list with a field this app's schema does not know (as from a newer server). */
const withStranger = (list: List, name: string) =>
  ({ ...list, name, surprise: true }) as unknown as List;

describe('keeping only valid entities', () => {
  it('passes valid data through untouched', () => {
    const { workspace } = world();
    expect(keepValid(workspace, workspace, validate)).toEqual({ workspace, skipped: [] });
  });

  it('keeps the old version of an entity that arrives invalid, and lets the rest through', () => {
    const { ctx, workspace, list } = world();
    const other = createList(ctx, workspace, { name: 'Work', color: '#A7C7E7' });
    const after = putEntity(
      putEntity(other.workspace, 'lists', withStranger(list, 'Garden 2')),
      'lists',
      { ...other.list, name: 'Office' },
    );
    const { workspace: kept, skipped } = keepValid(other.workspace, after, validate);
    expect(validate(kept).valid).toBe(true);
    const names = kept.entities.lists.map((each) => each.name);
    expect(names).toContain('Garden');
    expect(names).toContain('Office');
    expect(skipped).toEqual([expect.objectContaining({ collection: 'lists', id: list.id })]);
  });

  it('leaves out a new entity that is invalid', () => {
    const { ctx, workspace } = world();
    const made = createList(ctx, workspace, { name: 'New', color: '#A7C7E7' });
    const after = putEntity(workspace, 'lists', withStranger(made.list, 'New'));
    const { workspace: kept, skipped } = keepValid(workspace, after, validate);
    expect(kept.entities.lists.some((each) => each.id === made.list.id)).toBe(false);
    expect(skipped).toHaveLength(1);
  });
});

describe('keeping only valid entities: what is checked (R-FB-94)', () => {
  it('checks only what changed: `before` is taken as valid, as it was checked when taken in', () => {
    const { ctx, workspace, list } = world();
    // An entity `before` already holds as it is (by identity) is not checked again, even one this
    // schema refuses: storage is checked on opening and every earlier answer on arrival, so
    // nothing unchecked can be in `before`.
    const before = putEntity(workspace, 'lists', withStranger(list, 'Garden'));
    const added = createList(ctx, before, { name: 'Work', color: '#A7C7E7' });
    const checked: unknown[] = [];
    const { workspace: kept, skipped } = keepValid(before, added.workspace, (document) => {
      checked.push(document);
      return validate(document);
    });
    expect(skipped).toEqual([]);
    expect(kept).toBe(added.workspace);
    const seen = (checked[0] as { entities: { lists: List[] } }).entities.lists;
    expect(seen.map((each) => each.name)).toEqual(['Work']);
  });

  it('still refuses a changed entity, whatever else is unchanged around it', () => {
    const { workspace, list } = world();
    const after = putEntity(workspace, 'lists', withStranger(list, 'Garden 2'));
    const { workspace: kept, skipped } = keepValid(workspace, after, validate);
    expect(skipped.map((each) => each.id)).toEqual([list.id]);
    expect(kept.entities.lists.find((each) => each.id === list.id)).toBe(list);
  });
});
