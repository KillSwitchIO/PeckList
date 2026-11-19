import { describe, expect, it } from 'vitest';
import { createAjvValidator } from '../adapters/ajv-validator.ts';
import { testContext } from '../test/fixtures.ts';
import { getEntity } from './collections.ts';
import { openDocument } from './io.ts';
import { inboxList } from './lists.ts';
import { capStoredNotes, clampNotes, createTask, MAX_NOTES_LENGTH, updateTask } from './tasks.ts';
import { createWorkspace } from './workspace.ts';

// A shared task's notes are read in full (links included) by every app that shows it, so the
// schema bounds them, as it bounds a comment (security review of PL-146, note 3).
describe('task notes length (0.14.0)', () => {
  const long = 'a'.repeat(MAX_NOTES_LENGTH + 10);

  it('are cut to the limit when a task is made or its notes change', () => {
    const ctx = testContext();
    const ws = createWorkspace(ctx);
    const made = createTask(ctx, ws, { title: 'Long', listId: inboxList(ws).id, notes: long });
    expect(made.task.notes).toHaveLength(MAX_NOTES_LENGTH);
    const changed = updateTask(ctx, made.workspace, made.task.id, { notes: `${long}b` });
    expect(getEntity(changed, 'tasks', made.task.id)?.notes).toHaveLength(MAX_NOTES_LENGTH);
    // Within the limit, as written.
    const short = updateTask(ctx, changed, made.task.id, { notes: 'short' });
    expect(getEntity(short, 'tasks', made.task.id)?.notes).toBe('short');
  });

  it('never split an emoji at the cut', () => {
    const cut = clampNotes(`${'a'.repeat(MAX_NOTES_LENGTH - 1)}😀 more`);
    expect(cut).toHaveLength(MAX_NOTES_LENGTH - 1);
    expect(cut.endsWith('a')).toBe(true);
  });

  it('kept longer before the limit still open, cut to it', () => {
    const ctx = testContext();
    const ws = createWorkspace(ctx);
    const made = createTask(ctx, ws, { title: 'Old', listId: inboxList(ws).id });
    // As stored before the limit: longer notes than the schema allows now.
    const stored = {
      ...made.workspace,
      entities: {
        ...made.workspace.entities,
        tasks: made.workspace.entities.tasks.map((task) =>
          task.id === made.task.id ? { ...task, notes: long } : task,
        ),
      },
    };
    expect(createAjvValidator().validate(stored).valid).toBe(false);
    const opened = openDocument(JSON.parse(JSON.stringify(stored)), createAjvValidator());
    expect(opened.kind).toBe('ok');
    if (opened.kind !== 'ok') return;
    expect(getEntity(opened.workspace, 'tasks', made.task.id)?.notes).toHaveLength(
      MAX_NOTES_LENGTH,
    );
    // Nothing to cut: the same document back.
    expect(capStoredNotes(made.workspace)).toBe(made.workspace);
  });
});
