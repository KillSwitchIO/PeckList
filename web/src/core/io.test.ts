import { CURRENT_SCHEMA_VERSION } from './migrations.ts';
import { describe, expect, it } from 'vitest';
import { createAjvValidator } from '../adapters/ajv-validator.ts';
import { sampleTask, sampleWorkspace, T0, testContext } from '../test/fixtures.ts';
import { importCounts, importWorkspace, openDocument, parseJson, upgradeDocument } from './io.ts';
import { createList } from './lists.ts';
import { updateEntity } from './ops.ts';
import { siblings, createTask } from './tasks.ts';
import { createTemplate, fromListTemplate, templateOfList, templatesOf } from './templates.ts';
import type { WorkspaceFile } from './types.ts';
import { createWorkspace, serializeWorkspace } from './workspace.ts';

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

  it('opens data saved with a hidden tab on a full bottom bar, cut to the four the bar holds', () => {
    const workspace = sampleWorkspace();
    const stored = JSON.parse(serializeWorkspace(workspace)) as {
      entities: { settings: Record<string, unknown>[] };
    };
    stored.entities.settings[0]!.bottomBar = ['today', 'inbox', 'calendar', 'search', 'list:gone'];
    const result = openDocument(stored, validator);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.workspace.entities.settings[0]?.bottomBar).toEqual([
      'today',
      'inbox',
      'calendar',
      'search',
    ]);
    // Everything else as it was.
    expect({
      ...result.workspace,
      entities: { ...result.workspace.entities, settings: [] },
    }).toEqual({ ...workspace, entities: { ...workspace.entities, settings: [] } });
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
    // the sidebar is shown (normalizeSidebar), not in the stored layout (Search too, R-FB-112,
    // and Templates, PL-140).
    const expected = structuredClone(workspace);
    const sidebar = expected.entities.settings[0]!.sidebar;
    expected.entities.settings[0]!.sidebar = {
      ...sidebar,
      order: sidebar.order.filter((id) => !['due', 'search', 'templates'].includes(id)),
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
    expect(importCounts(here, merged)).toEqual({ tasks: 1, lists: 0, tags: 0, templates: 0 });
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

describe('templates in an exported file (PL-140)', () => {
  const ZONE = 'America/Chicago';

  /** A list template, Camping: Tent due the day after use at 9:00, with a Pegs subtask due on the day. */
  function withCampingTemplate(): { workspace: WorkspaceFile; templateId: string } {
    const ctx = testContext();
    let ws = createWorkspace(ctx);
    const list = createList(ctx, ws, { name: 'Camping', color: '#2e7d32', icon: 'tent' });
    const tent = createTask(ctx, list.workspace, {
      title: 'Tent',
      listId: list.list.id,
      due: { at: '2026-11-24T09:00', allDay: false, timeZone: ZONE },
    });
    ws = createTask(ctx, tent.workspace, {
      title: 'Pegs',
      listId: list.list.id,
      parentId: tent.task.id,
      due: { at: '2026-11-23', allDay: true, timeZone: ZONE },
    }).workspace;
    const saved = createTemplate(ctx, ws, {
      name: 'Camping',
      kind: 'list',
      body: templateOfList(ws, list.list.id, '2026-11-23'),
    });
    return { workspace: saved.workspace, templateId: saved.template.id };
  }

  it('keeps a list template, its subtasks and relative dates, from export to import on another device', () => {
    const { workspace, templateId } = withCampingTemplate();
    const file = openDocument(JSON.parse(serializeWorkspace(workspace)), validator);
    if (file.kind !== 'ok') throw new Error(file.kind);
    // Another person's device: the file becomes this owner's, its templates with it.
    const here = createWorkspace(testContext('dev2', T0, '01TESTMEMBER00000000000002'));
    const merged = importWorkspace(here, file.workspace);
    expect(openDocument(JSON.parse(serializeWorkspace(merged)), validator).kind).toBe('ok');

    const [template] = templatesOf(merged);
    expect(template).toMatchObject({ id: templateId, name: 'Camping', kind: 'list' });
    expect(template!.body).toEqual(templatesOf(workspace)[0]!.body);

    // Used there in May, the dates count from the day it is used.
    const used = fromListTemplate(testContext('dev2', T0, here.owner), merged, templateId, '', {
      day: '2027-05-01',
      timeZone: ZONE,
    });
    const [tent] = siblings(used.workspace, used.listId, null);
    expect([tent!.title, tent!.due?.at]).toEqual(['Tent', '2027-05-02T09:00']);
    expect(
      siblings(used.workspace, used.listId, tent!.id).map((task) => [task.title, task.due?.at]),
    ).toEqual([['Pegs', '2027-05-01']]);
  });

  it('imports a file from before templates (schema 20) without touching the templates here', () => {
    const { workspace: here } = withCampingTemplate();
    const old = JSON.parse(serializeWorkspace(sampleWorkspace(testContext('dev3')))) as {
      schemaVersion: number;
      entities: Record<string, unknown>;
    };
    old.schemaVersion = 20;
    delete old.entities.templates;
    expect(openDocument(old, validator).kind).toBe('needs-upgrade');

    const upgraded = upgradeDocument(old, validator);
    if (upgraded.kind !== 'ok') throw new Error(upgraded.kind);
    expect(upgraded.workspace.entities.templates).toEqual([]);
    const merged = importWorkspace(here, upgraded.workspace);
    expect(templatesOf(merged).map((template) => template.name)).toEqual(['Camping']);
    expect(merged.entities.tasks.map((task) => task.title)).toEqual(
      expect.arrayContaining(['Tent', 'Pegs', 'Mow lawn', 'Call vet']),
    );
  });
});
