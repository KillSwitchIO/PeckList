import { CURRENT_SCHEMA_VERSION } from './migrations.ts';
import { describe, expect, it } from 'vitest';
import { createAjvValidator } from '../adapters/ajv-validator.ts';
import { sampleTask, sampleWorkspace, T0, testContext } from '../test/fixtures.ts';
import { addComment } from './comments.ts';
import {
  adoptedId,
  importCounts,
  importWorkspace,
  openDocument,
  parseJson,
  upgradeDocument,
} from './io.ts';
import { members, setElement } from './ops.ts';
import { createTag } from './tags.ts';
import { PURGED_AT } from './trash.ts';
import { createList } from './lists.ts';
import { updateEntity } from './ops.ts';
import { siblings, createTask } from './tasks.ts';
import {
  createTemplate,
  fromListTemplate,
  templateOfList,
  templatesOf,
  templateOfTask,
} from './templates.ts';
import type { Task, WorkspaceFile } from './types.ts';
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

describe("importWorkspace: another account's file, on a server (1.0)", () => {
  const ANN = '01TESTMEMBER00000000000002';
  const CAL = '01TESTMEMBER00000000000003';

  /** Ann's export: a list Ben already has (shared with him), and one of her own with all kinds of links. */
  function setup() {
    const benCtx = testContext('dev1');
    const ben = createWorkspace(benCtx);
    const sharedList = createList(benCtx, ben, { name: 'Shared', color: '#CFE3A3' });
    const here = sharedList.workspace;

    const annCtx = testContext('dev2', T0, ANN);
    const calCtx = testContext('dev3', T0, CAL);
    let theirs = createWorkspace(annCtx);
    theirs = {
      ...theirs,
      entities: { ...theirs.entities, lists: [...theirs.entities.lists, sharedList.list] },
    };
    const camping = createList(annCtx, theirs, { name: 'Camping', color: '#A7C7E7' });
    const tag = createTag(annCtx, camping.workspace, 'outdoors');
    const tent = createTask(annCtx, tag.workspace, {
      title: 'Tent',
      listId: camping.list.id,
      tags: [tag.tag.id],
    });
    const pegs = createTask(annCtx, tent.workspace, {
      title: 'Pegs',
      listId: camping.list.id,
      parentId: tent.task.id,
    });
    // Pegs waits on Tent, and Tent is Ann's and Cal's.
    let ws = pegs.workspace;
    ws = {
      ...ws,
      entities: {
        ...ws.entities,
        tasks: ws.entities.tasks.map((task): Task => {
          if (task.id === pegs.task.id) {
            return { ...task, blockedBy: setElement(annCtx, task.blockedBy, tent.task.id, true) };
          }
          if (task.id !== tent.task.id) return task;
          let assignees = setElement(annCtx, task.assignees, `user:${ANN}`, true);
          assignees = setElement(annCtx, assignees, `user:${CAL}`, true);
          return { ...task, assignees };
        }),
      },
    };
    const mine = addComment(annCtx, ws, tent.task.id, 'Bring the big one');
    const cals = addComment(calCtx, mine.workspace, tent.task.id, 'I have one');
    const saved = createTemplate(annCtx, cals.workspace, {
      name: 'Tent',
      kind: 'task',
      body: templateOfTask(cals.workspace, tent.task.id, '2026-11-22'),
    });
    return {
      here,
      theirs: saved.workspace,
      sharedList: sharedList.list,
      tent: tent.task,
      tag: tag.tag,
    };
  }

  it('gives fresh ids to what this account does not hold, and changes every reference to match', () => {
    const { here, theirs, sharedList, tent, tag } = setup();
    const merged = importWorkspace(here, theirs, { onServer: true });
    const me = here.owner;
    const live = (ws: WorkspaceFile) => ws.entities.tasks.filter((task) => task.deletedAt === null);
    const newTent = live(merged).find((task) => task.title === 'Tent')!;
    const newPegs = live(merged).find((task) => task.title === 'Pegs')!;
    expect(newTent.id).toBe(adoptedId(tent.id, me));
    expect(newPegs.parentId).toBe(newTent.id);
    expect(members(newPegs.blockedBy)).toEqual([newTent.id]);
    expect(members(newTent.tags)).toEqual([adoptedId(tag.id, me)]);
    const camping = merged.entities.lists.find((list) => list.name === 'Camping')!;
    expect(newTent.listId).toBe(camping.id);
    const template = templatesOf(merged).find((each) => each.name === 'Tent')!;
    expect((template.body as { tags: string[] }).tags).toEqual([adoptedId(tag.id, me)]);
    // Nothing keeps one of Ann's ids but the list Ben already had.
    const annIds = new Set(
      Object.values(theirs.entities).flatMap((list) => list.map((entity) => entity.id)),
    );
    const kept = Object.values(merged.entities)
      .flatMap((list) => list.map((entity) => entity.id))
      .filter((id) => annIds.has(id));
    expect(kept).toEqual([sharedList.id]);
    expect(/^[0-9A-HJKMNP-TV-Z]{26}$/.test(newTent.id)).toBe(true);
  });

  it("comes in as this account's own: made by it, its lists, assigned to it at most, no one else's people or words", () => {
    const { here, theirs } = setup();
    const merged = importWorkspace(here, theirs, { onServer: true });
    const me = here.owner;
    const newTent = merged.entities.tasks.find((task) => task.title === 'Tent')!;
    expect(newTent.createdBy).toBe(me);
    expect(members(newTent.assignees)).toEqual([`user:${me}`]);
    const camping = merged.entities.lists.find((list) => list.name === 'Camping')!;
    expect([camping.createdBy, camping.visibility]).toEqual([me, 'private']);
    expect(merged.entities.comments.map((comment) => comment.body)).toEqual(['Bring the big one']);
    expect(merged.entities.users.some((user) => user.id === ANN)).toBe(false);
    // Ann's settings never replace Ben's.
    expect(merged.entities.settings).toEqual(here.entities.settings);
  });

  it('leaves out what was purged, and links to it; a trashed task comes in trashed', () => {
    const { here, theirs, tent } = setup();
    const annCtx = testContext('dev2', T0, ANN);
    const binnedAt = new Date(T0).toISOString();
    const gone = createTask(annCtx, theirs, { title: 'Old stakes', listId: tent.listId });
    const binned = createTask(annCtx, gone.workspace, { title: 'Old tarp', listId: tent.listId });
    const file: WorkspaceFile = {
      ...binned.workspace,
      entities: {
        ...binned.workspace.entities,
        tasks: binned.workspace.entities.tasks.map((task): Task => {
          if (task.id === gone.task.id) return { ...task, deletedAt: PURGED_AT };
          if (task.id === binned.task.id) return { ...task, deletedAt: binnedAt };
          if (task.id !== tent.id) return task;
          return { ...task, blockedBy: setElement(annCtx, task.blockedBy, gone.task.id, true) };
        }),
      },
    };
    const merged = importWorkspace(here, file, { onServer: true });
    const me = here.owner;
    const ids = merged.entities.tasks.map((task) => task.id);
    expect(ids).not.toContain(adoptedId(gone.task.id, me));
    expect(ids).not.toContain(gone.task.id);
    const newTent = merged.entities.tasks.find((task) => task.id === adoptedId(tent.id, me))!;
    expect(Object.keys(newTent.blockedBy)).toEqual([]);
    const tarp = merged.entities.tasks.find((task) => task.title === 'Old tarp')!;
    expect([tarp.id, tarp.deletedAt]).toEqual([adoptedId(binned.task.id, me), binnedAt]);
  });

  it('imported again, gives the same ids: nothing new', () => {
    const { here, theirs } = setup();
    const once = importWorkspace(here, theirs, { onServer: true });
    const twice = importWorkspace(once, theirs, { onServer: true });
    expect(importCounts(once, twice)).toEqual({ tasks: 0, lists: 0, tags: 0, templates: 0 });
  });

  it('keeps the ids of a file from this same account, or with no server to refuse them', () => {
    const { here, theirs, tent } = setup();
    expect(importWorkspace(here, theirs).entities.tasks.map((task) => task.id)).toContain(tent.id);
    const own = structuredClone(theirs);
    own.owner = here.owner;
    expect(
      importWorkspace(here, own, { onServer: true }).entities.tasks.map((task) => task.id),
    ).toContain(tent.id);
  });
});
