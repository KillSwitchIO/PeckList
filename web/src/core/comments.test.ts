import { describe, expect, it } from 'vitest';
import { sampleWorkspace, testContext } from '../test/fixtures.ts';
import {
  addComment,
  canChangeComment,
  commentsOf,
  deleteComment,
  editComment,
  mentionAt,
} from './comments.ts';

describe('comments', () => {
  it('adds, edits and deletes, oldest first, trimming the text', () => {
    const ctx = testContext();
    let ws = sampleWorkspace(ctx);
    const task = ws.entities.tasks[0]!;
    const first = addComment(ctx, ws, task.id, '  Blue?  ');
    ws = first.workspace;
    ws = addComment(ctx, ws, task.id, 'Or **green**').workspace;
    expect(commentsOf(ws, task.id).map((comment) => comment.body)).toEqual([
      'Blue?',
      'Or **green**',
    ]);
    expect(first.comment.createdBy).toBe(ctx.userId);
    expect(first.comment.editedAt).toBeNull();

    ws = editComment(ctx, ws, first.comment.id, 'Blue, definitely');
    const edited = commentsOf(ws, task.id)[0]!;
    expect(edited.body).toBe('Blue, definitely');
    expect(edited.editedAt).not.toBeNull();
    // Unchanged text is no edit.
    expect(editComment(ctx, ws, first.comment.id, 'Blue, definitely ')).toBe(ws);

    ws = deleteComment(ctx, ws, first.comment.id);
    expect(commentsOf(ws, task.id)).toHaveLength(1);
    expect(() => addComment(ctx, ws, task.id, '   ')).toThrow();
  });

  it('lets the author edit, and the author or the list owner delete', () => {
    const ctx = testContext();
    const ws = sampleWorkspace(ctx);
    const mine = addComment(ctx, ws, ws.entities.tasks[0]!.id, 'Mine').comment;
    expect(canChangeComment(ws, ctx.userId, mine)).toEqual({ edit: true, delete: true });
    // Someone else, not the owner of the list (the Mess Drawer is the first user's).
    expect(canChangeComment(ws, '01TESTMEMBER00000000000009', mine)).toEqual({
      edit: false,
      delete: false,
    });
    const theirs = { ...mine, createdBy: '01TESTMEMBER00000000000009' };
    expect(canChangeComment(ws, ctx.userId, theirs)).toEqual({ edit: false, delete: true });
  });

  it('finds the @name being typed', () => {
    expect(mentionAt('Thanks @sa', 10)).toEqual({ start: 7, query: 'sa' });
    expect(mentionAt('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionAt('mail me@home', 12)).toBeNull();
    expect(mentionAt('Thanks @sam done', 16)).toBeNull();
  });

  // As the comment reader counts mentions (audit D3), so the picker offers no name the server
  // would not notify.
  it('opens only where the sent comment would count the name', () => {
    expect(mentionAt('Ask (@jo', 8)).toEqual({ start: 5, query: 'jo' });
    expect(mentionAt('**@jo**', 5)).toEqual({ start: 2, query: 'jo' });
    expect(mentionAt('First\n\n@jo', 10)).toEqual({ start: 7, query: 'jo' });
    expect(mentionAt('@sa and more', 3)).toEqual({ start: 0, query: 'sa' });
    // In code, closed after the caret or not yet.
    expect(mentionAt('Run `ping @jo` now', 13)).toBeNull();
    // In a link's label.
    expect(mentionAt('[ask @jo](https://example.com)', 8)).toBeNull();
    // Not a name's first letter, or no word start.
    expect(mentionAt('@.jo', 4)).toBeNull();
    expect(mentionAt('@-', 2)).toBeNull();
    expect(mentionAt('x@jo', 4)).toBeNull();
    expect(mentionAt('@@jo', 4)).toBeNull();
  });
});
