// A harness for running the real web client (store, sync engine, HTTP transport) against a real
// Punchlist server from Node, several people at once. Used by *.server.test.ts, which run only
// when PUNCHLIST_URL (and PUNCHLIST_ADMIN_PASSWORD) name a server to try.
import { expect } from 'vitest';
import { createAjvValidator } from '../adapters/ajv-validator.ts';
import { createHttpSync } from '../adapters/http-sync.ts';
import { createMemoryStorage } from '../adapters/memory-storage.ts';
import { createUlidGenerator } from '../adapters/ulid-ids.ts';
import { createSyncEngine, type SyncEngine } from '../app/sync/syncEngine.ts';
import { createWorkspaceStore, type WorkspaceStore } from '../app/store/workspaceStore.ts';
import { createList } from '../core/lists.ts';
import type { OpContext } from '../core/ops.ts';
import { acceptFriendship, sendFriendRequest, shareList } from '../core/sharing.ts';
import { createTask } from '../core/tasks.ts';
import type { WorkspaceFile } from '../core/types.ts';
import type { SyncTransport } from '../ports/sync.ts';

// Node's environment, without Node's types in the web project.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
export const BASE = env?.PUNCHLIST_URL ?? '';
export const ADMIN_PASSWORD = env?.PUNCHLIST_ADMIN_PASSWORD ?? '';
export const enabled = BASE !== '' && ADMIN_PASSWORD !== '';

let addresses = 0;

/**
 * fetch with its own cookie jar and address: one per person, like one browser each on its own
 * network (passed as a trusted proxy would, so sign-in limits count each person apart).
 */
export function cookieFetch(): typeof fetch {
  const cookies = new Map<string, string>();
  addresses += 1;
  const address = `10.250.${Math.floor(addresses / 250)}.${(addresses % 250) + 1}`;
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    if (cookies.size > 0) {
      headers.set('Cookie', [...cookies].map(([key, value]) => `${key}=${value}`).join('; '));
    }
    headers.set('Origin', BASE);
    headers.set('X-Forwarded-For', address);
    const response = await fetch(input, { ...init, headers, redirect: 'manual' });
    for (const line of response.headers.getSetCookie()) {
      const [pair = ''] = line.split(';');
      const at = pair.indexOf('=');
      const key = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      if (value === '' || /max-age=0|expires=thu, 01 jan 1970/i.test(line)) cookies.delete(key);
      else cookies.set(key, value);
    }
    return response;
  };
}

export interface Person {
  name: string;
  id: string;
  /** For signing in again on another device */
  password: string;
  store: WorkspaceStore;
  sync: SyncEngine;
  transport: SyncTransport;
  /** Change the workspace as this person, then sync. */
  act: (change: (ctx: OpContext, ws: WorkspaceFile) => WorkspaceFile) => Promise<void>;
  ws: () => WorkspaceFile;
  syncNow: () => Promise<void>;
  /** Sync when the server may take something back: returns its notice (then dismissed). */
  syncExpectingNotice: () => Promise<{ refused: number; lostLists: string[] } | null>;
}

const validator = createAjvValidator();
let unique = 0;

/** A new client signed in as `username`; a first sign-in changes the generated password. */
export async function signIn(username: string, password: string): Promise<Person> {
  unique += 1;
  const node = `hunt${unique}`;
  const store = createWorkspaceStore({
    storage: createMemoryStorage(),
    validator,
    ids: createUlidGenerator(),
    node,
  });
  await store.getState().init();
  const transport = createHttpSync(BASE, cookieFetch(), node);
  const sync = createSyncEngine({
    transport,
    workspace: store,
    storage: createMemoryStorage(),
    debounceMs: 600_000,
    intervalMs: 600_000,
  });
  await sync.getState().start();
  const outcome = await sync.getState().signIn(username, password);
  if (outcome.kind !== 'ok') throw new Error(`${username} could not sign in: ${outcome.kind}`);
  let current = password;
  if (outcome.account.mustChangePassword) {
    current = `${password}-changed!`;
    const changed = await sync.getState().changePassword(password, current);
    if (changed.kind !== 'ok') throw new Error(`${username} could not change password`);
  }
  await waitFor(() => sync.getState().phase === 'ready', `${username} ready`);
  const account = sync.getState().account!;
  const person: Person = {
    name: username,
    id: account.id,
    password: current,
    store,
    sync,
    transport,
    ws: () => store.getState().workspace!,
    syncNow: async () => {
      await sync.getState().syncNow();
      check(person);
    },
    syncExpectingNotice: async () => {
      await sync.getState().syncNow();
      check(person, true);
      const notice = sync.getState().notice;
      sync.getState().dismissNotice();
      return notice ? { refused: notice.refused, lostLists: notice.lostLists } : null;
    },
    act: async (change) => {
      store.getState().apply(change);
      await person.syncNow();
    },
  };
  check(person);
  return person;
}

/** What should hold after every sync: valid data, nothing refused, no error. */
export function check(person: Person, noticeExpected = false) {
  const state = person.sync.getState();
  const errors = validator.validate(person.ws()).errors;
  expect(errors, `${person.name}'s workspace is valid`).toEqual([]);
  expect(state.error, `${person.name}'s sync error`).toBeNull();
  if (!noticeExpected) expect(state.notice, `${person.name}'s refused changes`).toBeNull();
}

export async function waitFor(ok: () => boolean, what: string, ms = 10_000) {
  const until = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Everyone syncs, twice round, so what one sent the others have. */
export async function settle(...people: Person[]) {
  for (let round = 0; round < 2; round += 1) {
    for (const person of people) await person.syncNow();
  }
}

/** The signed-in admin, and a way to make accounts (each with its own generated password). */
export async function admin() {
  const person = await signIn('admin', ADMIN_PASSWORD);
  const api = person.transport.admin!;
  return {
    person,
    api,
    async addUser(username: string) {
      const made = await api.addUser(username, 'user');
      if (!made.ok) throw new Error(`could not add ${username}: ${made.reason}`);
      return signIn(username, made.value.password);
    },
  };
}

/** A name nobody has used on this server yet. */
export function fresh(base: string) {
  return `${base}${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

export async function befriend(a: Person, b: Person) {
  await a.act((ctx, ws) => sendFriendRequest(ctx, ws, b.id));
  await settle(a, b);
  const request = b
    .ws()
    .entities.friendships.find((each) => each.deletedAt === null && each.state === 'pending');
  expect(request, `${b.name} sees ${a.name}'s request`).toBeDefined();
  await b.act((ctx, ws) => acceptFriendship(ctx, ws, request!.id));
  await settle(a, b);
}

/** A list `owner` shares with `others` (role each), holding one task; returns their ids. */
export async function sharedList(
  owner: Person,
  others: [Person, 'editor' | 'viewer'][],
  name: string,
) {
  let listId = '';
  let taskId = '';
  await owner.act((ctx, ws) => {
    const made = createList(ctx, ws, { name, color: '#CFE3A3' });
    listId = made.list.id;
    let next = made.workspace;
    for (const [person, role] of others)
      next = shareList(ctx, next, listId, `user:${person.id}`, role);
    const added = createTask(ctx, next, { title: `${name} task`, listId });
    taskId = added.task.id;
    return added.workspace;
  });
  await settle(owner, ...others.map(([person]) => person));
  return { listId, taskId };
}
