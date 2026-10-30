#!/usr/bin/env node
// Notification drill (spec: PL-061): make every kind of notification happen for one person, from
// the outside, so they can watch each arrive on a phone or in a browser. A second account (the
// "bot", an admin, acting through an API key) shares a list, assigns tasks, comments, mentions and
// sets reminders for the target; the target does nothing but look at the device, and press the
// buttons on the notifications. Nothing here runs on the device: it drives the server only.
//
//   PUNCHLIST_URL=https://tasks.example.com PUNCHLIST_TOKEN_FILE=~/.punchlist-drill.token \
//   PUNCHLIST_TARGET=ben node scripts/notification-drill.mjs <command>
//
// Commands, in the order a drill usually runs them:
//   setup                     friends, a group with both, a shared list   -> "shared"
//   assign                    a task assigned to the target               -> "assigned"
//   group-assign              a task assigned to the group                -> "groupAssigned" (Call dibs)
//   claim                     the bot calls dibs on that task             -> "claimed"
//   comment                   the bot comments on the assigned task       -> "commented"
//   edit-comment              and changes the words                       -> "commentEdited"
//   mention                   a comment with @target                      -> "mentioned"
//   reminder [minutes] [--constant] [--repeat] [--all-day]
//                             a task for the target that reminds in N minutes (default 7)
//   status                    what the drill's tasks look like on the server now
//   cleanup                   delete everything the drill made (the group and friendship too)
//
// The bot's key needs tasks:write, notifications and admin (an admin account). The state between
// commands (ids, the sync cursor) sits in PUNCHLIST_DRILL_STATE (default .notification-drill.json).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const SCHEMA_VERSION = 16;
const NODE = 'drill';
const ORIGIN = 'notification-drill';

// ---------------------------------------------------------------------------------------------
// Ids, clocks and local times

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A ULID: 48 bits of time, 80 of randomness, Crockford base32. */
export function ulid(now = Date.now()) {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = randomBytes(16);
  let random = '';
  for (let i = 0; i < 16; i++) random += CROCKFORD[bytes[i] % 32];
  return time + random;
}

/** Hybrid logical clock stamps that only move forward, even within one millisecond. */
export class Clock {
  #last = 0;
  #counter = 0;
  constructor(now = () => Date.now()) {
    this.now = now;
  }
  tick() {
    const wall = this.now();
    if (wall > this.#last) {
      this.#last = wall;
      this.#counter = 0;
    } else {
      this.#counter++;
    }
    return `${new Date(this.#last).toISOString()}-${String(this.#counter).padStart(4, '0')}-${NODE}`;
  }
}

/** A local date-time ("2026-11-03T09:00") or date ("2026-11-03") for an instant in a zone. */
export function localIn(zone, at, { allDay = false } = {}) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(new Date(at))
      .map((part) => [part.type, part.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return allDay ? date : `${date}T${parts.hour}:${parts.minute}`;
}

// ---------------------------------------------------------------------------------------------
// Entities, checked against the workspace schema so a malformed one never reaches a device

const here = dirname(fileURLToPath(import.meta.url));
let schema;
function defs() {
  schema ??= JSON.parse(readFileSync(join(here, '..', 'schema', 'workspace.schema.json'), 'utf8'));
  return schema.$defs;
}

const SHAPES = {
  id: /^[0-9A-HJKMNP-TV-Z]{26}$/,
  hlc: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z-\d{4}-[A-Za-z0-9]{1,32}$/,
  dateTime: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  local: /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/,
  color: /^#[0-9A-Fa-f]{6}$/,
  orderKey: /^[0-9A-Za-z]*[1-9A-Za-z]$/,
};

/**
 * The checks that matter for a device opening its data: every required field present, no field
 * the schema does not know (the app refuses a workspace with unevaluated properties), and the
 * identifying fields well formed. Throws with the problem; returns the entity otherwise.
 */
export function check(def, entity) {
  const all = defs();
  const own = all[def];
  if (!own) throw new Error(`no schema definition "${def}"`);
  const allowed = new Set([...Object.keys(all.base.properties), ...Object.keys(own.properties)]);
  const required = new Set([...all.base.required, ...own.required]);
  for (const key of Object.keys(entity)) {
    if (!allowed.has(key))
      throw new Error(`${def} ${entity.id}: field "${key}" is not in the schema`);
  }
  for (const key of required) {
    if (!(key in entity))
      throw new Error(`${def} ${entity.id}: required field "${key}" is missing`);
  }
  const bad = (field, shape, value) => {
    if (!shape.test(value))
      throw new Error(`${def} ${entity.id}: ${field} "${value}" is malformed`);
  };
  bad('id', SHAPES.id, entity.id);
  bad('createdBy', SHAPES.id, entity.createdBy);
  bad('createdAt', SHAPES.dateTime, entity.createdAt);
  for (const [field, hlc] of Object.entries(entity._hlc)) bad(`_hlc.${field}`, SHAPES.hlc, hlc);
  for (const key of Object.keys(entity)) {
    if (key !== 'id' && key !== '_hlc' && !(key in entity._hlc)) {
      throw new Error(`${def} ${entity.id}: "${key}" has no clock`);
    }
  }
  for (const ref of ['listId', 'taskId', 'parentId', 'sectionId', 'folderId']) {
    if (ref in entity && entity[ref] !== null) bad(ref, SHAPES.id, entity[ref]);
  }
  if ('principal' in entity)
    bad('principal', /^(user|group):[0-9A-HJKMNP-TV-Z]{26}$/, entity.principal);
  if ('color' in entity) bad('color', SHAPES.color, entity.color);
  if ('order' in entity) bad('order', SHAPES.orderKey, entity.order);
  for (const set of ['tags', 'assignees', 'blockedBy']) {
    if (!(set in entity)) continue;
    for (const [element, state] of Object.entries(entity[set])) {
      if (typeof state?.in !== 'boolean')
        throw new Error(`${def} ${entity.id}: ${set}.${element} has no "in"`);
      bad(`${set}.${element}.hlc`, SHAPES.hlc, state.hlc);
    }
  }
  if (entity.schedule) bad('schedule.start', SHAPES.local, entity.schedule.start);
  for (const reminder of entity.reminders ?? []) {
    if ('at' in reminder) bad('reminder.at', SHAPES.local, reminder.at);
  }
  return entity;
}

/** A new entity, every field stamped with one clock, as the app's createEntity does. */
export function create(ctx, def, fields, id = ulid()) {
  const hlc = ctx.clock.tick();
  const entity = {
    id,
    createdAt: new Date(ctx.clock.now()).toISOString(),
    createdBy: ctx.userId,
    deletedAt: null,
    origin: ORIGIN,
    ...fields,
  };
  entity._hlc = Object.fromEntries(
    Object.keys(entity)
      .filter((key) => key !== 'id')
      .map((key) => [key, hlc]),
  );
  return check(def, entity);
}

/** The entity with some fields changed, only those stamped anew. */
export function update(ctx, def, entity, patch) {
  const hlc = ctx.clock.tick();
  const next = { ...entity, _hlc: { ...entity._hlc } };
  for (const [key, value] of Object.entries(patch)) {
    if (JSON.stringify(entity[key]) === JSON.stringify(value)) continue;
    next[key] = value;
    next._hlc[key] = hlc;
  }
  return check(def, next);
}

export const member = (hlc, isIn = true) => ({ in: isIn, hlc });

export function task(ctx, fields) {
  return create(ctx, 'task', {
    title: fields.title,
    notes: fields.notes ?? '',
    listId: fields.listId,
    sectionId: null,
    parentId: null,
    order: fields.order ?? 'a1',
    status: 'open',
    completedAt: null,
    completedBy: null,
    priority: 0,
    schedule: fields.schedule ?? null,
    due: null,
    tags: {},
    assignees: fields.assignees ?? {},
    blockedBy: {},
    recurrence: fields.recurrence ?? null,
    progress: 0,
    ...(fields.reminders ? { reminders: fields.reminders } : {}),
    ...(fields.constantReminder ? { constantReminder: true } : {}),
  });
}

// ---------------------------------------------------------------------------------------------
// The server

class Server {
  constructor(url, token) {
    this.url = url.replace(/\/$/, '');
    this.token = token;
  }

  async call(method, path, body) {
    const response = await fetch(`${this.url}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${method} ${path} answered ${response.status}: ${text.slice(0, 300)}`);
    }
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }

  /** Push changes; throw if the server refused any of them. */
  async push(changes, cursor = null) {
    const answer = await this.call('POST', '/api/sync', {
      schemaVersion: SCHEMA_VERSION,
      cursor,
      changes,
    });
    const refused = [...(answer.invalid ?? []), ...(answer.rejected ?? [])];
    if (refused.length > 0)
      throw new Error(`the server refused: ${JSON.stringify(refused).slice(0, 500)}`);
    return answer;
  }

  /** Everything the bot can see, by id. */
  async pull() {
    const seen = new Map();
    let cursor = null;
    for (;;) {
      const answer = await this.call('POST', '/api/sync', {
        schemaVersion: SCHEMA_VERSION,
        cursor,
        changes: [],
      });
      for (const change of answer.changes ?? [])
        seen.set(change.entity.id, { collection: change.collection, entity: change.entity });
      for (const id of answer.revoked ?? []) seen.delete(id);
      cursor = answer.cursor;
      if (!answer.more) break;
    }
    return seen;
  }
}

// ---------------------------------------------------------------------------------------------
// The drill

function env(name, fallback) {
  const value = process.env[name];
  if (value) return value;
  if (fallback !== undefined) return fallback;
  console.error(`${name} is not set.`);
  process.exit(2);
}

function loadState(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
}

function saveState(path, state) {
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

// A four-digit code in everything one run makes, so the person can report "received 4821".
let code = '';

function say(expect) {
  console.log(`\nCode ${code}. Expect on the target's device: ${expect}`);
}

async function people(server, targetName) {
  const users = await server.call('GET', '/api/admin/users');
  const target = users.find((user) => user.username === targetName);
  if (!target) throw new Error(`no account named "${targetName}"`);
  // The key's owner: the one account whose keys list is readable is ours, but simpler, the server
  // tells us through /auth/me only with a session; so the bot names itself.
  const botName = env('PUNCHLIST_BOT', 'pl-notify-bot');
  const bot = users.find((user) => user.username === botName);
  if (!bot)
    throw new Error(
      `no account named "${botName}" (set PUNCHLIST_BOT to the key owner's username)`,
    );
  return { target, bot };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') {
    console.log(
      readFileSync(fileURLToPath(import.meta.url), 'utf8')
        .split('\n')
        .slice(1, 26)
        .map((line) => line.replace(/^\/\/ ?/, ''))
        .join('\n'),
    );
    return;
  }
  const url = env('PUNCHLIST_URL');
  const token =
    process.env.PUNCHLIST_TOKEN ?? readFileSync(env('PUNCHLIST_TOKEN_FILE'), 'utf8').trim();
  const targetName = env('PUNCHLIST_TARGET');
  const zone = env('PUNCHLIST_ZONE', 'America/Chicago');
  const statePath = env('PUNCHLIST_DRILL_STATE', '.notification-drill.json');
  const state = loadState(statePath);
  const server = new Server(url, token);
  const { target, bot } = await people(server, targetName);
  const ctx = { clock: new Clock(), userId: bot.id };
  const flag = (name) => args.includes(name);
  code = String(1000 + Math.floor(Math.random() * 9000));
  const number = args.find((arg) => /^\d+$/.test(arg));

  const need = (key, what) => {
    if (!state[key]) throw new Error(`run "setup" first (no ${what} yet)`);
    return state[key];
  };
  const current = async (id, what) => {
    const found = (await server.pull()).get(id);
    if (!found) throw new Error(`the ${what} ${id} is not on the server any more`);
    return found.entity;
  };

  switch (command) {
    case 'setup': {
      await server
        .call('POST', '/api/admin/friendships', { userA: bot.id, userB: target.id })
        .catch((error) => {
          if (!/409|already/i.test(String(error))) throw error;
        });
      const group = await server.call('POST', '/api/admin/groups', {
        name: 'Drill crew',
        offeredForSharing: true,
      });
      await server.call('PUT', `/api/admin/groups/${group.id}/members/${target.id}`);
      await server.call('PUT', `/api/admin/groups/${group.id}/members/${bot.id}`);
      const list = create(ctx, 'list', {
        name: `Notification drill ${code}`,
        color: '#7C4DFF',
        icon: null,
        folderId: null,
        visibility: 'shared',
        archived: false,
        order: 'a1',
        isInbox: false,
      });
      const membership = create(ctx, 'listMember', {
        listId: list.id,
        principal: `user:${target.id}`,
        role: 'editor',
      });
      await server.push([
        { collection: 'lists', entity: list },
        { collection: 'listMembers', entity: membership },
      ]);
      Object.assign(state, {
        listId: list.id,
        membershipId: membership.id,
        groupId: group.id,
        tasks: [],
        comments: [],
      });
      saveState(statePath, state);
      console.log(
        `Friends, group "Drill crew" (${group.id}), list "Notification drill" (${list.id}) shared with ${target.username}.`,
      );
      say(
        `"${bot.username} shared Notification drill with you" (the Android app: at its next check-in, within its interval; a browser: at once if push is on).`,
      );
      break;
    }
    case 'assign': {
      const listId = need('listId', 'list');
      const made = task(ctx, {
        title: `Drill ${code}: assigned to you`,
        listId,
        assignees: { [`user:${target.id}`]: member(ctx.clock.tick()) },
      });
      await server.push([{ collection: 'tasks', entity: made }]);
      state.tasks.push(made.id);
      state.assignedTaskId = made.id;
      saveState(statePath, state);
      console.log(`Task ${made.id} assigned to ${target.username}.`);
      say(`"${bot.username} assigned you ${made.title}" with Open task.`);
      break;
    }
    case 'group-assign': {
      const listId = need('listId', 'list');
      const groupId = need('groupId', 'group');
      const made = task(ctx, {
        title: `Drill ${code}: for the group`,
        listId,
        assignees: { [`group:${groupId}`]: member(ctx.clock.tick()) },
      });
      await server.push([{ collection: 'tasks', entity: made }]);
      state.tasks.push(made.id);
      state.groupTaskId = made.id;
      saveState(statePath, state);
      console.log(`Task ${made.id} assigned to the group.`);
      say(
        `"${bot.username} assigned ${made.title} to your group" with Open task and Call dibs. Press Call dibs if you want: the bot's "claim" step is the other way round.`,
      );
      break;
    }
    case 'claim': {
      const id = need('groupTaskId', 'group task');
      const groupId = need('groupId', 'group');
      const before = await current(id, 'group task');
      const hlc = ctx.clock.tick();
      const after = update(ctx, 'task', before, {
        assignees: {
          ...before.assignees,
          [`group:${groupId}`]: member(hlc, false),
          [`user:${bot.id}`]: member(hlc, true),
        },
      });
      await server.push([{ collection: 'tasks', entity: after }]);
      console.log(`The bot called dibs on ${id}.`);
      say(`"${bot.username} called dibs on ${before.title}".`);
      break;
    }
    case 'comment': {
      const id = need('assignedTaskId', 'assigned task');
      const made = create(ctx, 'comment', {
        taskId: id,
        body: `Drill ${code}: a comment, no mention.`,
        editedAt: null,
      });
      await server.push([{ collection: 'comments', entity: made }]);
      state.comments.push(made.id);
      state.commentId = made.id;
      saveState(statePath, state);
      say(`"${bot.username} commented on <the assigned task>" with Open task.`);
      break;
    }
    case 'edit-comment': {
      const id = need('commentId', 'comment');
      const before = await current(id, 'comment');
      const after = update(ctx, 'comment', before, {
        body: `${before.body} Edited: drill ${code}.`,
        editedAt: new Date().toISOString(),
      });
      await server.push([{ collection: 'comments', entity: after }]);
      say(`"${bot.username} edited a comment on <the assigned task>".`);
      break;
    }
    case 'mention': {
      const id = need('assignedTaskId', 'assigned task');
      const made = create(ctx, 'comment', {
        taskId: id,
        body: `@${target.username} drill ${code}: can you look at this?`,
        editedAt: null,
      });
      await server.push([{ collection: 'comments', entity: made }]);
      state.comments.push(made.id);
      saveState(statePath, state);
      say(
        `"${bot.username} mentioned you in <the assigned task>" (a mention, not a plain comment: one notice).`,
      );
      break;
    }
    case 'reminder': {
      const listId = need('listId', 'list');
      const minutes = Number(number ?? 7);
      const allDay = flag('--all-day');
      const at = Date.now() + minutes * 60_000;
      const start = localIn(zone, at, { allDay });
      const kind = [
        flag('--constant') && 'constant',
        flag('--repeat') && 'repeating',
        allDay && 'all-day',
      ]
        .filter(Boolean)
        .join(', ');
      const made = task(ctx, {
        title: `Drill ${code}: reminder${kind ? ` (${kind})` : ''} ${new Date(at).toLocaleTimeString('en-US')}`,
        listId,
        assignees: { [`user:${target.id}`]: member(ctx.clock.tick()) },
        schedule: { start, end: null, allDay, timeZone: zone },
        // An all-day task counts from 9:00 that day; "at" pins the exact minute instead.
        reminders: allDay ? [{ at: localIn(zone, at) }] : [{ before: 0 }],
        constantReminder: flag('--constant'),
        recurrence: flag('--repeat') ? 'FREQ=DAILY' : null,
      });
      await server.push([{ collection: 'tasks', entity: made }]);
      state.tasks.push(made.id);
      state.reminderTaskId = made.id;
      saveState(statePath, state);
      console.log(
        `Task ${made.id} reminds at ${new Date(at).toISOString()} (${start} ${zone}); it is assigned to ${target.username}, so the reminder is theirs.`,
      );
      say(
        `the reminder "${made.title}" at ${new Date(at).toLocaleTimeString('en-US')} with Complete and Snooze` +
          (flag('--constant')
            ? ', then again every 5 minutes until it is done (12 times at most)'
            : '') +
          (flag('--repeat') ? '; Complete opens the app, since the task repeats' : '') +
          `. The Android app learns of it at its next check-in (it must come before the time; ${minutes} minutes leaves room for a 5-minute interval); a browser with push on gets it from the server at the time.`,
      );
      break;
    }
    case 'status': {
      const all = await server.pull();
      const ids = new Set([...(state.tasks ?? []), ...(state.comments ?? [])]);
      for (const [id, { collection, entity }] of all) {
        if (!ids.has(id)) continue;
        if (collection === 'tasks') {
          const who = Object.entries(entity.assignees ?? {})
            .filter(([, s]) => s.in)
            .map(([p]) => p)
            .join(' ');
          console.log(
            `task ${id}: "${entity.title}" ${entity.status}${entity.completedAt ? ` at ${entity.completedAt} by ${entity.completedBy}` : ''}; assignees ${who || 'none'}; reminders ${JSON.stringify(entity.reminders ?? [])}${entity.deletedAt ? '; deleted' : ''}`,
          );
        } else {
          console.log(
            `comment ${id} on ${entity.taskId}: "${entity.body}"${entity.editedAt ? ` (edited ${entity.editedAt})` : ''}${entity.deletedAt ? '; deleted' : ''}`,
          );
        }
      }
      break;
    }
    case 'cleanup': {
      const all = await server.pull();
      const gone = new Date().toISOString();
      const changes = [];
      for (const [id, { collection, entity }] of all) {
        const mine =
          id === state.listId ||
          id === state.membershipId ||
          state.tasks?.includes(id) ||
          state.comments?.includes(id);
        if (!mine || entity.deletedAt) continue;
        const def = {
          lists: 'list',
          listMembers: 'listMember',
          tasks: 'task',
          comments: 'comment',
        }[collection];
        changes.push({ collection, entity: update(ctx, def, entity, { deletedAt: gone }) });
      }
      if (changes.length > 0) await server.push(changes);
      if (state.groupId)
        await server.call('DELETE', `/api/admin/groups/${state.groupId}`).catch(() => {});
      await server.call('DELETE', `/api/admin/friendships/${bot.id}/${target.id}`).catch(() => {});
      saveState(statePath, {});
      console.log(`Deleted ${changes.length} entities, the group and the friendship.`);
      break;
    }
    default:
      console.error(`Unknown command "${command}". Run with --help.`);
      process.exit(2);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message ?? error);
    process.exit(1);
  });
}
