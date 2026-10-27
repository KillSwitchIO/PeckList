import { describe, expect, it } from 'vitest';
import { createTask } from './tasks.ts';
import { repairText, wellFormed } from './wellFormed.ts';
import { sampleWorkspace, testContext } from '../test/fixtures.ts';

describe('wellFormed', () => {
  it('replaces a lone half of a surrogate pair and keeps whole emoji', () => {
    expect(wellFormed('a\uDC8Fb')).toBe('a�b');
    expect(wellFormed('a\uD83Db')).toBe('a�b');
    expect(wellFormed('ok 🗓 day')).toBe('ok 🗓 day');
  });
});

describe('repairText', () => {
  it('fixes broken text as an edit and leaves good data alone', () => {
    const ctx = testContext();
    let ws = sampleWorkspace(ctx);
    const listId = ws.entities.lists[0]!.id;
    ws = createTask(ctx, ws, { title: 'Fine 🗓', listId }).workspace;
    expect(repairText(ctx, ws)).toBe(ws);

    const made = createTask(ctx, ws, { title: 'Cut \uDC8F', listId, notes: 'x\uD83D' });
    const before = made.task;
    const fixed = repairText(ctx, made.workspace).entities.tasks.find((t) => t.id === before.id)!;
    expect(fixed.title).toBe('Cut �');
    expect(fixed.notes).toBe('x�');
    // A real edit: newer clocks, so every copy takes the fixed text.
    expect(fixed._hlc.title! > before._hlc.title!).toBe(true);
  });
});
