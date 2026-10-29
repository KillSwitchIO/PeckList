import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Clock,
  check,
  create,
  localIn,
  member,
  task,
  ulid,
  update,
} from './notification-drill.mjs';

const ctx = () => ({
  clock: new Clock(() => 1_767_225_600_000),
  userId: '01M5T9HR6JS053ZMJNSMX4NNR4',
});

test('ulid: 26 Crockford characters that sort by time', () => {
  const earlier = ulid(1_000);
  const later = ulid(2_000);
  assert.match(earlier, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.ok(earlier < later);
});

test('clock: stamps move forward within one millisecond', () => {
  const clock = new Clock(() => 1_767_225_600_000);
  const first = clock.tick();
  const second = clock.tick();
  assert.equal(first, '2026-01-01T00:00:00.000Z-0000-drill');
  assert.equal(second, '2026-01-01T00:00:00.000Z-0001-drill');
  assert.ok(first < second);
});

test('localIn: a local date-time or date in the zone, 24-hour', () => {
  const at = Date.UTC(2026, 10, 3, 15, 5); // 09:05 in Chicago (CST)
  assert.equal(localIn('America/Chicago', at), '2026-11-03T09:05');
  assert.equal(localIn('America/Chicago', at, { allDay: true }), '2026-11-03');
  assert.equal(localIn('UTC', Date.UTC(2026, 0, 1, 0, 0)), '2026-01-01T00:00');
});

test('task: a complete, schema-shaped task with the fields the drill sets', () => {
  const c = ctx();
  const made = task(c, {
    title: 'Drill',
    listId: '01M5T9HR6JS053ZMJNSMX4NNR4',
    assignees: { 'user:01M5T9HR6JS053ZMJNSMX4NNR4': member(c.clock.tick()) },
    schedule: { start: '2026-11-03T09:05', end: null, allDay: false, timeZone: 'America/Chicago' },
    reminders: [{ before: 0 }],
    constantReminder: true,
  });
  assert.equal(made.status, 'open');
  assert.equal(made.notes, '');
  assert.equal(made.constantReminder, true);
  assert.deepEqual(
    Object.keys(made._hlc).sort(),
    Object.keys(made)
      .filter((k) => k !== 'id' && k !== '_hlc')
      .sort(),
  );
  assert.equal(made.createdBy, c.userId);
  assert.equal(made.origin, 'notification-drill');
});

test('check: refuses a field the schema does not know, and a missing required one', () => {
  const c = ctx();
  const made = task(c, { title: 'x', listId: '01M5T9HR6JS053ZMJNSMX4NNR4' });
  assert.throws(
    () => check('task', { ...made, extra: 1, _hlc: { ...made._hlc, extra: c.clock.tick() } }),
    /field "extra"/,
  );
  const { notes, ...without } = made;
  void notes;
  assert.throws(() => check('task', without), /required field "notes"/);
  assert.throws(() => check('task', { ...made, color: 'red' }), /field "color"/);
  assert.throws(
    () => create(c, 'comment', { taskId: 'short', body: 'hi', editedAt: null }),
    /field "taskId"|malformed/,
  );
});

test('update: stamps only the fields that changed', () => {
  const c = ctx();
  const made = create(c, 'comment', {
    taskId: '01M5T9HR6JS053ZMJNSMX4NNR4',
    body: 'first',
    editedAt: null,
  });
  const same = update(c, 'comment', made, { body: 'first' });
  assert.equal(same._hlc.body, made._hlc.body);
  const changed = update(c, 'comment', made, {
    body: 'second',
    editedAt: '2026-01-01T00:00:01.000Z',
  });
  assert.notEqual(changed._hlc.body, made._hlc.body);
  assert.equal(changed._hlc.body, changed._hlc.editedAt);
  assert.equal(changed._hlc.taskId, made._hlc.taskId);
  assert.equal(made.body, 'first');
});
