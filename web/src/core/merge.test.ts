import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sampleTask, testContext } from '../test/fixtures.ts';
import { mergeCollection, mergeElementSets, mergeEntity, mergeWorkspaces } from './merge.ts';
import { setElement, softDelete, updateEntity, type OpContext } from './ops.ts';
import { ELEMENT_SET_FIELDS, type BaseEntity, type CollectionName, type Task } from './types.ts';
import { createWorkspace } from './workspace.ts';

const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'schema', 'fixtures', 'merge');

interface MergeFixture {
  description: string;
  collection: CollectionName;
  a: BaseEntity[];
  b: BaseEntity[];
  expected: BaseEntity[];
}

describe('shared merge fixtures (must match the server implementation)', () => {
  const files = readdirSync(FIXTURES).filter((file) => file.endsWith('.json'));

  it('has fixtures', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const fixture = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')) as MergeFixture;
    const sets = ELEMENT_SET_FIELDS[fixture.collection];
    it(`${file}: ${fixture.description}`, () => {
      expect(mergeCollection(fixture.a, fixture.b, sets)).toEqual(fixture.expected);
      expect(mergeCollection(fixture.b, fixture.a, sets)).toEqual(fixture.expected);
    });
  }
});

describe('mergeEntity', () => {
  it('refuses to merge different ids', () => {
    const ctx = testContext();
    const a = sampleTask(ctx, 'L', 'a');
    const b = sampleTask(ctx, 'L', 'b');
    expect(() => mergeEntity(a, b)).toThrow('different entities');
  });

  it('keeps a field present on only one side', () => {
    const merged = mergeEntity(
      {
        id: 'X',
        extra: 1,
        _hlc: { extra: '2026-10-20T16:00:00.000Z-0000-a' },
      } as unknown as BaseEntity,
      { id: 'X', _hlc: {} } as unknown as BaseEntity,
    ) as unknown as Record<string, unknown>;
    expect(merged.extra).toBe(1);
  });

  it('breaks ties on unstamped fields deterministically', () => {
    const a = { id: 'X', note: 'apple', _hlc: {} } as unknown as BaseEntity;
    const b = { id: 'X', note: 'banana', _hlc: {} } as unknown as BaseEntity;
    expect(mergeEntity(a, b)).toEqual(mergeEntity(b, a));
  });
});

describe('mergeElementSets', () => {
  it('handles missing sets', () => {
    expect(mergeElementSets(undefined, undefined)).toEqual({});
    const set = { x: { in: true, hlc: '2026-10-20T16:00:00.000Z-0000-a' } };
    expect(mergeElementSets(set, undefined)).toEqual(set);
  });
});

describe('mergeWorkspaces', () => {
  it('merges entities and keeps local metadata', () => {
    const ctx = testContext('dev1');
    const base = createWorkspace(ctx);
    const remote = { ...structuredClone(base), node: 'dev2' };
    remote.entities.tasks.push(sampleTask(ctx, base.entities.lists[0]!.id, 'remote task'));
    const merged = mergeWorkspaces(base, remote);
    expect(merged.node).toBe('dev1');
    expect(merged.entities.tasks).toHaveLength(1);
  });

  it('refuses different owners or schema versions', () => {
    const base = createWorkspace(testContext());
    expect(() => mergeWorkspaces(base, { ...base, owner: 'someone-else' })).toThrow(
      'different owners',
    );
    expect(() => mergeWorkspaces(base, { ...base, schemaVersion: 2 })).toThrow('schema versions');
  });
});

// --- property-based convergence --------------------------------------------------------

type Edit =
  | { kind: 'title'; value: string }
  | { kind: 'priority'; value: 0 | 1 | 2 | 3 }
  | { kind: 'tag'; tag: string; present: boolean }
  | { kind: 'delete' }
  | { kind: 'restore' };

const editArb: fc.Arbitrary<Edit> = fc.oneof(
  fc.record({ kind: fc.constant('title' as const), value: fc.string({ maxLength: 8 }) }),
  fc.record({
    kind: fc.constant('priority' as const),
    value: fc.constantFrom(0 as const, 1 as const, 2 as const, 3 as const),
  }),
  fc.record({
    kind: fc.constant('tag' as const),
    tag: fc.constantFrom('t1', 't2', 't3'),
    present: fc.boolean(),
  }),
  fc.record({ kind: fc.constant('delete' as const) }),
  fc.record({ kind: fc.constant('restore' as const) }),
);

function apply(ctx: OpContext, task: Task, edit: Edit): Task {
  switch (edit.kind) {
    case 'title':
      return updateEntity(ctx, task, { title: edit.value });
    case 'priority':
      return updateEntity(ctx, task, { priority: edit.value });
    case 'tag':
      return { ...task, tags: setElement(ctx, task.tags, edit.tag, edit.present) };
    case 'delete':
      return softDelete(ctx, task);
    case 'restore':
      return updateEntity(ctx, task, { deletedAt: null });
  }
}

function replica(node: string, base: Task, edits: Edit[], start: number): Task {
  const ctx = testContext(node, start);
  return edits.reduce((task, edit) => apply(ctx, task, edit), base);
}

describe('merge convergence (property)', () => {
  const base = sampleTask(testContext('base'), '01TESTCAT00000000000000001', 'base');
  const editsArb = fc.array(editArb, { maxLength: 12 });
  const startArb = fc
    .integer({ min: 0, max: 5000 })
    .map((offset) => Date.UTC(2026, 9, 21) + offset);
  const sets = ELEMENT_SET_FIELDS.tasks;

  it('is commutative', () => {
    fc.assert(
      fc.property(editsArb, editsArb, startArb, startArb, (ea, eb, sa, sb) => {
        const a = replica('a', base, ea, sa);
        const b = replica('b', base, eb, sb);
        expect(mergeEntity(a, b, sets)).toEqual(mergeEntity(b, a, sets));
      }),
    );
  });

  it('is associative', () => {
    fc.assert(
      fc.property(editsArb, editsArb, editsArb, startArb, (ea, eb, ec, s) => {
        const a = replica('a', base, ea, s);
        const b = replica('b', base, eb, s + 7);
        const c = replica('c', base, ec, s + 13);
        expect(mergeEntity(mergeEntity(a, b, sets), c, sets)).toEqual(
          mergeEntity(a, mergeEntity(b, c, sets), sets),
        );
      }),
    );
  });

  it('is idempotent', () => {
    fc.assert(
      fc.property(editsArb, startArb, (ea, s) => {
        const a = replica('a', base, ea, s);
        expect(mergeEntity(a, a, sets)).toEqual(a);
        const once = mergeEntity(a, base, sets);
        expect(mergeEntity(once, base, sets)).toEqual(once);
      }),
    );
  });

  it('never loses an edit that is the latest for its field', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 8 }),
        fc.constantFrom(0 as const, 1 as const, 2 as const, 3 as const),
        (title, priority) => {
          const a = replica('a', base, [{ kind: 'title', value: title }], Date.UTC(2026, 9, 22));
          const b = replica(
            'b',
            base,
            [{ kind: 'priority', value: priority }],
            Date.UTC(2026, 9, 22),
          );
          const merged = mergeEntity(a, b, sets);
          expect(merged.title).toBe(a.title);
          expect(merged.priority).toBe(b.priority);
        },
      ),
    );
  });
});
