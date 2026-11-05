# HTTP API

The web app talks to the server over JSON. That API is usable from scripts, but it is **not yet a
stable public API**: it can change in any minor version. Pin the PeckList version if you script
against it, and read the changelog when upgrading.

## Swagger and OpenAPI

Every server describes its own API: the OpenAPI 3.1 document is at `/api/openapi/v1.json`, and
**`/api/docs`** is a Swagger UI page that reads it. There you can browse the routes by area and
try them: press **Authorize** and paste an API key (below), or just use the page in a browser
that is signed in to the server. Point other tools at the document: code generators, Postman or
Bruno, an AI assistant's HTTP tool, a ChatGPT Custom GPT action.

Both are public, like the source code: they show what the API offers, never anyone's data.
[`API_DOCS=off`](../configuration/reference.md#api_docs) turns them off.

## Signing in from a script

The easy way is an **API key**: make one in **Settings > Account > API keys** with a name, an expiry (or
none) and only the permissions the script needs, copy it (it is shown once), and send it with
every request:

```bash
curl -H 'Authorization: Bearer pl_...' https://tasks.example.com/api/sync \
  -H 'Content-Type: application/json' -d '{"schemaVersion":16,"cursor":null,"changes":[]}'
```

| Permission      | Lets the key                                                               |
| --------------- | -------------------------------------------------------------------------- |
| `tasks:read`    | Sync without changes (everything you can see), `/api/events`, task history |
| `tasks:write`   | Push changes through `/api/sync` (comes with `tasks:read`)                 |
| `files:read`    | Download attachments                                                       |
| `files:write`   | Upload attachments (comes with `files:read`)                               |
| `notifications` | List notifications, mark them read, clear them                             |
| `admin`         | The admin API, as far as your role allows (admins only)                    |

A key works as you, so it never sees more than you do. It cannot do anything outside its
permissions: no sign-in or password routes, no account settings, no friends, and it cannot make
or revoke keys. Anything else answers `403 {"error":"scope"}`; an unknown, revoked or expired key
answers `401`. The server keeps only a hash of the secret, and when each key was last used (to
within a few minutes). Making and revoking keys go in the event log.

| Route                                 |                                                                              |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| `GET /api/account/api-keys`           | Your keys: `id`, `name`, `scopes`, `createdAt`, `expiresAt`, `lastUsedAt`, `revokedAt` |
| `POST /api/account/api-keys`          | `{"name","scopes","expiresAt"}` (`expiresAt` null: never); answers `{"key","token"}` once |
| `DELETE /api/account/api-keys/{id}`   | Revoke one at once                                                           |

These three take a signed-in session, never a key. With `AUTH_MODE=none` there are no keys.

### With a session cookie

Sessions are cookies. Sign in, keep the cookie, send it back:

```bash
curl -c cookies.txt -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"..."}' https://tasks.example.com/auth/login
curl -b cookies.txt https://tasks.example.com/api/admin/stats
```

An account that must change its password gets `403` from everything but `/auth/password` until it
does. Every admin route needs the matching [role](../guides/users-and-roles.md#roles).

## Open routes

| Route                 |                                                          |
| --------------------- | -------------------------------------------------------- |
| `GET /healthz`        | `200 Healthy` or `503`                                   |
| `GET /api/info`       | Name, version, schema version and time zone              |
| `GET /api/openapi/v1.json`, `GET /api/docs` | The API's OpenAPI document and its Swagger UI page (unless `API_DOCS=off`) |
| `GET /auth/providers` | The single sign-on providers offered on the sign-in page |

## Signing in

| Route                         |                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------- |
| `POST /auth/login`            | `{"username","password"}`; sets the session cookie                               |
| `POST /auth/logout`           | Ends the session                                                                 |
| `GET /auth/me`                | The signed-in account                                                            |
| `POST /auth/password`         | `{"current","next"}`                                                             |
| `GET /auth/oidc/{name}/login` | Starts a single sign-on; the provider calls back to `/auth/oidc/{name}/callback` |
| `GET /auth/link/{token}`      | A one-time sign-in link                                                          |
| `POST /auth/signup`           | `{"username","password","invite"}`; makes the account and signs in (see below)   |
| `GET /auth/invites/{token}`   | `200 {"expires"}` while an invite link works, else `404`                         |

`/auth/providers` also says who may sign up (`registration`: `open`, `invite` or `closed`), and
`localLogin` whether passwords work. With `LOCAL_LOGIN=disabled`, `/auth/login` and
`/auth/password` answer `403 local_login_disabled`. A
refused sign-up answers `403` (`registration_closed`, `invite_required`, `local_login_disabled`),
`409 username_taken` or `400` (`invalid_username`, `too_short`, `invite_invalid`). Sign-up shares
the sign-in rate limit.

## The app

| Route                                                |                                                 |
| ---------------------------------------------------- | ----------------------------------------------- |
| `POST /api/sync`                                     | Send changes and receive others' since a cursor |
| `GET /api/events`                                    | Server-sent events: something changed, sync now |
| `GET /api/account/sign-in`, `GET /api/account/stats` | Your sign-in methods, your stats                |
| `/api/friends/...`, `GET /api/users/lookup`          | Friend links and requests, finding people       |
| `GET /api/notifications`, `POST .../read`, `.../clear` | Your notifications; mark read or clear (`{"ids": [...]}`, or `null` for all) |
| `GET /api/tasks/{id}/history`                        | A task's changes, newest first: `at`, `actorId`, `field`, `before`, `after` (JSON values); 404 for a task you cannot see |
| `GET /api/push/key`, `POST /api/push/subscriptions`, `POST /api/push/unsubscribe` | Web Push: the server's VAPID key, this browser's subscription |

## Admin (`/api/admin`)

| Area     | Routes                                                                                                                                                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invites  | `GET/POST /invites`, `DELETE /invites/{id}`                                                                                                                                                                                       |
| Users    | `GET/POST /users`, `DELETE /users/{id}`, `POST /users/{id}/restore`, `POST /users/{id}/remove-now`, `PUT /users/{id}/disabled`, `PUT /users/{id}/role`, `POST /users/{id}/password`, `POST /users/{id}/login-link`, `POST /users/{id}/impersonate`               |
| Sign-in  | `GET/POST/DELETE /users/{id}/identities...`, `GET /providers`, `POST /providers/{name}/unbind-all`, `PUT/DELETE /providers/{name}/migration-window`, `GET /pending-signins`, `POST /pending-signins/{provider}/{subject}/approve` |
| Sharing  | `GET /users/{id}/friends`, `POST /friendships`, `DELETE /friendships/{a}/{b}`, `GET /users/{id}/shared`, `POST /users/{id}/hand-over`                                                                                             |
| Groups   | `GET/POST /groups`, `PATCH/DELETE /groups/{id}`, `PUT/DELETE /groups/{id}/members/{accountId}`                                                                                                                                    |
| Settings | `GET/PUT /settings`, `POST /restart`, `GET/PUT /setup`                                                                                                                                                                            |
| Backups  | `GET/POST /backups`, `GET /backups/{name}`, `GET /export`, `GET /users/{id}/export`, `POST /restore`, `POST /users/restore`                                                                                                       |
| Logs     | `GET /logging`, `GET /debug-dump`, `GET /audit`, `GET /audit.csv`                                                                                                                                                                 |
| Stats    | `GET /stats`                                                                                                                                                                                                                      |

The workspace data that `/api/sync` carries is described by the [workspace schema](../schema.md).
Each pushed change is checked on its own: one the server cannot take as it is (malformed, or
stamped more than an hour ahead of its clock) is listed in the response's `invalid` with its index,
id, `code` (`invalid_change` or `clock_drift`) and reason, and the rest of the push is stored. The
response's `serverTime` lets a device tell when its own clock is off.
