import { CURRENT_SCHEMA_VERSION } from './migrations.ts';
import { describe, expect, it } from 'vitest';
import { createAjvValidator } from '../adapters/ajv-validator.ts';
import { sampleTask, sampleWorkspace, T0, testContext } from '../test/fixtures.ts';
import { importCounts, importWorkspace, openDocument, parseJson, upgradeDocument } from './io.ts';
import { updateEntity } from './ops.ts';
import { serializeWorkspace } from './workspace.ts';

const validator = createAjvValidator();

describe('parseJson', () => {
  it('parses valid JSON and reports errors', () => {
    expect(parseJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    const bad = parseJson('{oops');
    expect(bad.ok).toBe(false);
  });
});

describe('openDocument', () => {
  it('opens a valid current-version workspace', () => {
    const workspace = sampleWorkspace();
    const reopened = JSON.parse(serializeWorkspace(workspace)) as unknown;
    expect(openDocument(reopened, validator)).toEqual({ kind: 'ok', workspace });
  });

  it('reports schema errors', () => {
    const workspace = sampleWorkspace();
    (workspace.entities.tasks[0] as unknown as Record<string, unknown>).priority = 7;
    const result = openDocument(workspace, validator);
    expect(result.kind).toBe('invalid');
  });

  it('refuses newer files and asks to upgrade older ones', () => {
    const newer = CURRENT_SCHEMA_VERSION + 1;
    expect(openDocument({ schemaVersion: newer }, validator)).toEqual({
      kind: 'needs-app-update',
      fileVersion: newer,
      supported: CURRENT_SCHEMA_VERSION,
    });
    expect(openDocument({ schemaVersion: 1 }, validator).kind).toBe('needs-upgrade');
    expect(openDocument({}, validator).kind).toBe('invalid');
  });
});

describe('upgradeDocument', () => {
  it('migrates then validates', () => {
    const workspace = sampleWorkspace();
    const old = { ...structuredClone(workspace), schemaVersion: 0 } as unknown as Record<
      string,
      unknown
    >;
    // schemaVersion 0 is malformed, so migration fails cleanly
    expect(upgradeDocument(old, validator).kind).toBe('invalid');
  });

  it('upgrades a version 1 workspace: tasks gain progress 0', () => {
    const workspace = sampleWorkspace();
    const legacy = structuredClone(workspace) as unknown as {
      schemaVersion: number;
      entities: { tasks: Record<string, unknown>[] };
    };
    legacy.schemaVersion = 1;
    for (const task of legacy.entities.tasks) delete task.progress;
    const result = upgradeDocument(legacy as unknown as Record<string, unknown>, validator);
    // The sidebar migration wrote the views of its day; views added since (Due dates) join when
    // the sidebar is shown (normalizeSidebar), not in the stored layout (Search too, R-FB-112).
    const expected = structuredClone(workspace);
    const sidebar = expected.entities.settings[0]!.sidebar;
    expected.entities.settings[0]!.sidebar = {
      ...sidebar,
      order: sidebar.order.filter((id) => id !== 'due' && id !== 'search'),
    };
    expect(result).toEqual({ kind: 'ok', workspace: expected });
  });
});

describe('importWorkspace', () => {
  it('merges an older copy of the same data without losing newer edits here', () => {
    const ctx = testContext();
    const here = sampleWorkspace(ctx);
    const exported = structuredClone(here);
    const task = here.entities.tasks[0]!;
    here.entities.tasks[0] = updateEntity(ctx, task, { title: 'Mow the lawn' });
    const extra = sampleTask(ctx, here.entities.lists[0]!.id, 'Only in the file');
    exported.entities.tasks.push(extra);

    const merged = importWorkspace(here, exported);
    expect(merged.entities.tasks.find((each) => each.id === task.id)?.title).toBe('Mow the lawn');
    expect(merged.entities.tasks.map((each) => each.title)).toContain('Only in the file');
    expect(importCounts(here, merged)).toEqual({ tasks: 1, lists: 0, tags: 0 });
  });

  it("takes in another person's file as this owner's, its Mess Drawer tasks moving into this one", () => {
    const here = sampleWorkspace(testContext('dev1'));
    const theirs = sampleWorkspace(testContext('dev2', T0, '01TESTMEMBER00000000000002'));
    const merged = importWorkspace(here, theirs);
    const inboxes = merged.entities.lists.filter((list) => list.isInbox && list.deletedAt === null);
    expect(inboxes).toHaveLength(1);
    expect(merged.owner).toBe(here.owner);
    expect(merged.entities.tasks).toHaveLength(4);
    expect(new Set(merged.entities.tasks.map((each) => each.listId))).toEqual(
      new Set([here.entities.lists[0]!.id]),
    );
    expect(merged.entities.tasks.every((each) => each.createdBy === here.owner)).toBe(true);
    expect(merged.entities.settings).toHaveLength(here.entities.settings.length);
    expect(openDocument(JSON.parse(serializeWorkspace(merged)), validator).kind).toBe('ok');
  });
});
