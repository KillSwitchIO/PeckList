# HTTP API

The web app talks to the server over JSON. That API is usable from scripts, but it is **not yet a
stable public API**: it can change in any minor version. Pin the Punchlist version if you script
against it, and read the changelog when upgrading.

## Signing in from a script

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

`/auth/providers` also says who may sign up (`registration`: `open`, `invite` or `closed`). A
refused sign-up answers `403` (`registration_closed`, `invite_required`, `local_login_hidden`),
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
