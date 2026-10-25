import { describe, expect, it } from 'vitest';
import { sampleTask, testContext } from '../test/fixtures.ts';
import { putEntity } from './collections.ts';
import { createList, deleteList, inboxList } from './lists.ts';
import { queryTerms, searchTasks, type SearchHit } from './search.ts';
import { createTag } from './tags.ts';
import { createTask, setTaskStatus, updateTask } from './tasks.ts';
import type { WorkspaceFile } from './types.ts';
import { createWorkspace } from './workspace.ts';

function setup() {
  const ctx = testContext();
  let ws: WorkspaceFile = createWorkspace(ctx);
  const inbox = inboxList(ws).id;
  const add = (
    title: string,
    notes = '',
    extra: Partial<Parameters<typeof createTask>[2]> = {},
  ) => {
    const result = createTask(ctx, ws, { title, listId: inbox, ...extra });
    ws = notes ? updateTask(ctx, result.workspace, result.task.id, { notes }) : result.workspace;
    return result.task;
  };
  return {
    ctx,
    add,
    get ws() {
      return ws;
    },
    set ws(next) {
      ws = next;
    },
  };
}

const titles = (hits: SearchHit[]) => hits.map((hit) => hit.task.title);
const marked = (text: string, ranges: readonly (readonly [number, number])[]) =>
  ranges.map(([a, b]) => text.slice(a, b));

describe('search', () => {
  it('needs every word, ignoring case and accents', () => {
    const s = setup();
    s.add('Call the café about Friday');
    s.add('Call mum');
    s.add('Fix fence', 'Need a new CAFE sign too');
    expect(queryTerms('  Café  cafe ')).toEqual(['cafe']);
    expect(titles(searchTasks(s.ws, 'cafe'))).toEqual(['Call the café about Friday', 'Fix fence']);
    expect(titles(searchTasks(s.ws, 'call FRIDAY'))).toEqual(['Call the café about Friday']);
    expect(searchTasks(s.ws, '   ')).toEqual([]);
    expect(searchTasks(s.ws, 'nothing here')).toEqual([]);
  });

  it('ranks title hits first, word starts higher, open before closed', () => {
    const s = setup();
    s.add('Notes mention paint', 'paint the shed');
    const closed = s.add('Paint the fence');
    s.add('Repaint door');
    s.add('Shopping', 'buy paint');
    s.ws = setTaskStatus(s.ctx, s.ws, closed.id, 'done');
    expect(titles(searchTasks(s.ws, 'paint'))).toEqual([
      'Notes mention paint',
      'Repaint door',
      'Shopping',
      'Paint the fence',
    ]);
  });

  it('marks matches in the title and a snippet of the notes', () => {
    const s = setup();
    s.add(
      'Plan the café trip',
      `${'Long intro text that goes on. '.repeat(3)}Remember the Café\n\non Main street`,
    );
    const [hit] = searchTasks(s.ws, 'cafe main');
    expect(marked(hit!.task.title, hit!.title)).toEqual(['café']);
    expect(hit!.snippet!.text.startsWith('…')).toBe(true);
    expect(hit!.snippet!.text).not.toContain('\n');
    expect(marked(hit!.snippet!.text, hit!.snippet!.ranges)).toEqual(['Café', 'Main']);
  });

  it('finds tasks by tag name and leaves out deleted ones', () => {
    const s = setup();
    const tagged = createTag(s.ctx, s.ws, 'garden', '#CFE3A3');
    s.ws = tagged.workspace;
    s.add('Water beans', '', { tags: [tagged.tag.id] });
    const gone = s.add('Water garden lights');
    s.ws = putEntity(s.ws, 'tasks', { ...gone, deletedAt: '2026-10-21T10:00:00.000Z' });
    const list = createList(s.ctx, s.ws, { name: 'Old', color: '#A7C7E7' });
    s.ws = list.workspace;
    s.add('Garden in an old list', '', { listId: list.list.id });
    s.ws = deleteList(s.ctx, s.ws, list.list.id);
    expect(titles(searchTasks(s.ws, 'garden'))).toEqual(['Water beans']);
  });

  // 100 ms on a desk machine; CI runs it under coverage on a shared runner, so it gets room there.
  // Best of five: one slow run (a collection, another job) is not the code getting slower.
  it('answers within 100 ms over 5,000 tasks', () => {
    const s = setup();
    const words = ['paint', 'fence', 'garden', 'call', 'email', 'review', 'invoice', 'shed'];
    // Built in one go (adding one by one is quadratic and only slows the test down).
    const listId = inboxList(s.ws).id;
    const tasks = Array.from({ length: 5000 }, (_, i) => ({
      ...sampleTask(s.ctx, listId, `${words[i % 8]} task ${i}`),
      notes: `notes about ${words[(i * 3) % 8]} number ${i}`,
    }));
    s.ws = { ...s.ws, entities: { ...s.ws.entities, tasks } };
    searchTasks(s.ws, 'warm up');
    let took = Infinity;
    let hits: ReturnType<typeof searchTasks> = [];
    for (let run = 0; run < 5; run += 1) {
      const started = performance.now();
      hits = searchTasks(s.ws, 'garden invoice');
      took = Math.min(took, performance.now() - started);
    }
    expect(hits.length).toBeGreaterThan(0);
    expect(took).toBeLessThan(process.env.CI ? 300 : 100);
  });
});
