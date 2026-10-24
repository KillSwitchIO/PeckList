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
