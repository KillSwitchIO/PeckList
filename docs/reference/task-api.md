# Task API

The task API is the way for scripts, home automation, chat bots and other tools to read and write
tasks. It lives under `/api/v1`, speaks plain JSON, and is **versioned**: within v1 it only gains
fields and routes, never loses or changes them (see [Versioning](#versioning)).

It covers tasks (make, change, complete, reopen, delete, restore, quick add), lists and sections
(make and rename), and reads tags. Everything else, such as sharing, friends and settings, stays
in the apps.

The apps themselves sync through `POST /api/sync`, which is internal: it changes with the apps
and is not meant for scripts. Use `/api/v1`.

## Signing in

Make an **API key** in **Settings > Account > API keys** with only the permissions the script
needs, and send it with every request as a Bearer token:

```bash
curl -H 'Authorization: Bearer pl_...' https://tasks.example.com/api/v1/me
```

| Permission    | In the task API                                     |
| ------------- | --------------------------------------------------- |
| `tasks:read`  | Every `GET` route                                   |
| `tasks:write` | Every `POST`, `PATCH` and `DELETE` route (and reads) |

`GET /api/v1/me` works with any key and says who you are, your role and the key's permissions,
which makes it a good first request. A key works as you: it sees and changes only what you could
in the app, by the same sharing rules. In a browser signed in to the server, the session cookie
works too. See [HTTP API](http-api.md#signing-in-from-a-script) for keys in general.

Keep keys secret: anyone holding one can act as you within its permissions until it expires or you
revoke it.

## Conventions

- **Bodies** are JSON objects, sent with `Content-Type: application/json`, at most 1 MB.
- **Ids** are strings. When you make something you may send your own `id`, a
  [ULID](https://github.com/ulid/spec) (26 characters of `0-9` and `A-Z` without `I`, `L`, `O` or
  `U`, as the apps make): sending the same create again then answers `200` with what is there
  instead of making a second one, so a retry is safe.
- **Times** such as `createdAt` and `completedAt` are UTC (`2026-11-10T15:04:05.000Z`).
- **Dates on tasks** are local: a schedule's `start` and a due date's `at` are a date
  (`2026-11-10`) or a local date-time (`2026-11-10T09:00`), with the IANA `timeZone` they are in.
  Leave `timeZone` out and your account's zone is used.
- **Tags** are names, such as `home/yard`. Naming a tag you don't have makes it.
- **Lists of things** come as `{"items": [...]}`: lists, sections and tags in one go, and
  `GET /api/v1/tasks` in pages, with `"next"` as well. Pass `next` back as `cursor` for the
  following page; it is `null` on the last one.

### Errors

Every error is a problem document (`application/problem+json`) with a stable `code`:

```json
{
  "type": "about:blank",
  "title": "Bad Request",
  "status": 400,
  "code": "invalid_request",
  "detail": "title: must not be empty",
  "errors": { "title": ["must not be empty"] }
}
```

| Status | `code`                      | When                                                                 |
| ------ | --------------------------- | -------------------------------------------------------------------- |
| 400    | `invalid_request`           | A field or filter is wrong; `errors` names each field                |
| 400    | `invalid_cursor`            | A cursor that did not come from this API                             |
| 401    | `unauthorized`              | No key, or an unknown, revoked or expired one                        |
| 403    | `scope`                     | The key lacks the permission this route needs                        |
| 403    | `forbidden`                 | The sharing rules don't let you make this change (a viewer editing)  |
| 404    | `not_found`                 | Nothing with that id that you can see                                |
| 409    | `conflict`                  | The change cannot be made as asked (a subtask in another list, nested too deep) |
| 409    | `id_taken`                  | The id you sent is used by something else                            |
| 413    | `too_large`                 | The body is over 1 MB                                                |
| 429    | `rate_limited`              | Too many requests: wait as the `Retry-After` header says             |
| 503    | `starting`                  | The server is starting up                                            |

Match on `code`, not on `detail`: the wording of `detail` can change.

### Rate limits

Each account may make 600 reads and 120 writes a minute through the task API, over all its keys
and sessions together. Past that it gets `429` with `Retry-After`.

## Routes

| Route                              |                                                                    |
| ---------------------------------- | ------------------------------------------------------------------ |
| `GET /api/v1/me`                   | You: `id`, `username`, `role`, and `key` (its `id`, `name`, `scopes`) |
| `GET /api/v1/lists`                | Lists you can see, with your `role` on each; `?archived=true` adds archived ones |
| `GET /api/v1/lists/{id}`           | One list                                                           |
| `POST /api/v1/lists`               | Make a list: `name`, optional `color` (`#RRGGBB`) and `id`         |
| `PATCH /api/v1/lists/{id}`         | Rename or recolor a list (its owner only)                          |
| `GET /api/v1/sections`             | Sections you can see; `?listId=` for one list's                    |
| `POST /api/v1/sections`            | Make a section: `name`, `listId`, optional `id`                    |
| `PATCH /api/v1/sections/{id}`      | Rename a section                                                   |
| `GET /api/v1/tags`                 | Your tags                                                          |
| `GET /api/v1/tasks`                | Tasks, filtered and paged (below)                                  |
| `GET /api/v1/tasks/{id}`           | One task                                                           |
| `POST /api/v1/tasks`               | Make a task                                                        |
| `POST /api/v1/tasks/quick`         | Make a task from a line of text, as the app's quick add            |
| `PATCH /api/v1/tasks/{id}`         | Change a task's fields                                             |
| `POST /api/v1/tasks/{id}/complete` | Close a task: optional `{"status": "wontdo"}` (default `done`)     |
| `POST /api/v1/tasks/{id}/reopen`   | Open a closed task again                                           |
| `DELETE /api/v1/tasks/{id}`        | Delete a task with its subtasks; answers `204`                     |
| `POST /api/v1/tasks/{id}/restore`  | Bring a deleted task back, with what went with it                  |
| `GET /api/v1/changes`              | What changed since a cursor (below)                                |

Every server also describes these routes, with each field, in its
[OpenAPI document](http-api.md#swagger-and-openapi) (`/api/openapi/v1.json`), under the `v1:` areas.

## Tasks

A task looks like this:

```json
{
  "id": "01JC8R5K2Z4N6PX0M3WQ7HB9TA",
  "title": "Mow the lawn",
  "notes": "",
  "listId": "01JC8R4V0ZB8Q4D9C2M7K1XJ5E",
  "sectionId": null,
  "parentId": null,
  "status": "open",
  "completedAt": null,
  "completedBy": null,
  "priority": 2,
  "schedule": { "start": "2026-11-14T09:00", "end": null, "allDay": false, "timeZone": "America/Chicago" },
  "due": null,
  "tags": ["home/yard"],
  "assignees": [],
  "recurrence": null,
  "progress": 0,
  "pinned": false,
  "createdAt": "2026-11-10T15:04:05.000Z",
  "createdBy": "01JC8R3M1Q2W3E4R5T6Y7U8I9O",
  "updatedAt": "2026-11-10T15:04:05.000Z",
  "deletedAt": null
}
```

`status` is `open`, `done` or `wontdo`. `priority` is 0 (none) to 3 (high). `assignees` are
`user:<id>` or `group:<id>`. `recurrence` is an RRULE such as `FREQ=WEEKLY;BYDAY=SA`.

### Finding tasks

`GET /api/v1/tasks` answers open tasks by default. Filters:

| Parameter   |                                                                 |
| ----------- | --------------------------------------------------------------- |
| `listId`    | In this list                                                    |
| `sectionId` | In this section                                                 |
| `parentId`  | Subtasks of this task; `none` for top-level tasks only          |
| `status`    | `open` (the default), `done`, `wontdo` or `all`                 |
| `tag`       | With this tag or one under it (`home` matches `home/yard`)      |
| `dueBefore` | Due on or before this date (`2026-11-30`)                       |
| `dueAfter`  | Due on or after this date                                       |
| `deleted`   | `true` for deleted tasks instead of live ones                   |
| `limit`     | Tasks a page, 1 to 500 (default 100)                            |
| `cursor`    | The `next` of the page before                                   |

An unknown parameter is a `400`, so a typo never silently widens a query.

### Making and changing tasks

`POST /api/v1/tasks` needs a `title`. Everything else is optional: `notes`, `listId` (left out:
your default list for new tasks, else your inbox; an account that has never opened the app has no
inbox yet, so it gets a `400` on `listId` until it names one), `sectionId`, `parentId` (a subtask goes in its
parent's list and starts with its tags), `priority`, `schedule`, `due`, `tags`, `assignees`,
`recurrence`, `progress` and `pinned`. It answers `201` with the task.

`PATCH /api/v1/tasks/{id}` changes only the fields you send; `null` clears one. To change tags
without sending the whole set, send `addTags` and `removeTags` instead of `tags`. Moving a task to
another list (`listId`) takes its subtasks along.

Each field keeps its own clock: a change you send wins over what was there, field by field, and
fields you don't send keep any edit made meanwhile on a phone or another computer. There is no
locking or `If-Match`; the last change to each field wins, as between the apps.

Closing a repeating task keeps a closed copy for the history and moves the task to its next date.
`/complete` then answers both: `{"completed": ..., "next": ...}`, with `next` null for a task that
doesn't repeat (or has run out).

### Quick add

`POST /api/v1/tasks/quick` reads a line the way the app's add box does:

```bash
curl -H 'Authorization: Bearer pl_...' -H 'Content-Type: application/json' \
  -d '{"text": "Pay rent tomorrow 9am #bills ^home !high every month"}' \
  https://tasks.example.com/api/v1/tasks/quick
```

Dates and times set the start (`due friday` sets the due date instead), `#tag` adds a tag (new
ones are made), `^list` picks a list by name, `!high`, `!med`, `!low` set the priority, `@name`
assigns someone you may assign, and `every ...` makes it repeat. See
[Quick add and shortcuts](../using/quick-add-and-shortcuts.md) for the whole grammar.

The body takes `text` (at most 1000 characters) and optionally `id`, `listId` (used when the text
names no list; needed, as for a create, by an account with no inbox yet) and `timeZone` (the zone the dates are read in; left out, your account's). It
answers `201` with `{"task": ..., "tokens": [...]}`: each token says what was recognised, its
`kind` (`date`, `due`, `tag`, `list`, `priority`, `person`, `repeat`) and where it is in the text
(`start` and `end` count UTF-16 code units, as JavaScript strings do). A line with nothing left
for a title, such as `!high tomorrow`, is a `400`.

## Keeping a copy in sync

`GET /api/v1/changes` is for tools that keep their own copy, such as a Home Assistant integration
or a calendar bridge. The first call, with no `cursor`, answers everything you can see; each
answer has a `cursor` to send next time, which then answers only what changed since:

```json
{
  "cursor": "48213",
  "more": false,
  "tasks": [],
  "lists": [],
  "sections": [],
  "tags": [],
  "revoked": []
}
```

Deleted things come with `deletedAt` set. `revoked` lists ids you can no longer see, for example
because a list stopped being shared with you: drop them from your copy. While `more` is `true`,
call again straight away with the new cursor; a page can be empty and still say `more`. Store the
cursor only after you have applied the page.

## Examples

### TypeScript

```ts
const base = 'https://tasks.example.com/api/v1';
const headers = {
  Authorization: `Bearer ${process.env.PECKLIST_TOKEN}`,
  'Content-Type': 'application/json',
};

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const problem = await response.json();
    throw new Error(`${problem.code}: ${problem.detail}`);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

// Everything due this week, then close the first one.
const page = await call<{ items: { id: string; title: string }[] }>(
  'GET',
  '/tasks?dueBefore=2026-11-15',
);
if (page.items[0]) await call('POST', `/tasks/${page.items[0].id}/complete`);

// Add one, safe to retry with the same id.
await call('POST', '/tasks', { id: 'water-plants-2026-11-10', title: 'Water plants', tags: ['home'] });
```

### curl

```bash
# Lists, then the open tasks of one
curl -H 'Authorization: Bearer pl_...' https://tasks.example.com/api/v1/lists
curl -H 'Authorization: Bearer pl_...' 'https://tasks.example.com/api/v1/tasks?listId=01JC8R4V0ZB8Q4D9C2M7K1XJ5E'

# Move a task's due date
curl -X PATCH -H 'Authorization: Bearer pl_...' -H 'Content-Type: application/json' \
  -d '{"due": {"at": "2026-11-20"}}' \
  https://tasks.example.com/api/v1/tasks/01JC8R5K2Z4N6PX0M3WQ7HB9TA
```

## Versioning

- **Within v1, nothing is taken away.** New fields and new routes can arrive in any release;
  existing fields keep their names, types and meaning, and error `code`s stay as they are. Write
  clients that ignore fields they don't know.
- **A breaking change means v2**, under `/api/v2`, announced in the changelog.
- **v1 stays for at least one minor release after v2 arrives.** During that time every v1 answer
  carries a `Deprecation` header, and the changelog says in which release v1 goes.
- `POST /api/sync` and the other routes outside `/api/v1` are not covered by this promise: they
  serve the apps and change with them.
