# Coding standards

The house style: how the code is laid out, what the checks enforce, the habits the code follows
and the shared pieces to reach for before writing a new one. [Developing](index.md) says how to
run things and [CONTRIBUTING.md](https://gitlab.com/killswitch10/pecklist/-/blob/main/CONTRIBUTING.md)
how branches, commits and merge requests work. Read all three before a change; this page is the
one to come back to while writing.

:::note[The project notes point here]

:::
The planning notes (the Obsidian vault: spec, roadmap, feature notes `PL-xxx`, decisions
`ADR-xxxx`) say _what_ to build and _why_. This page says _how_ the code is written. When the
two disagree, the notes win on behavior and this page wins on code; fix whichever is stale.

## Principles

- **Local first, one contract.** Every device holds a whole workspace and merges without
  conflicts; the server merges with the same rules. `schema/workspace.schema.json` and the
  fixtures under `schema/fixtures` are the contract both sides must pass. Nothing about the data
  lives only in one side's code.
- **Ports and adapters.** The web domain (`web/src/core`) knows no UI, no storage and no
  libraries; it talks through interfaces in `web/src/ports` with implementations in
  `web/src/adapters`. The server's `PeckList.Core` knows no ASP.NET and reaches storage through
  store interfaces. Swapping a library means a new adapter that passes the same contract suite.
- **Tests pin behavior.** A change in behavior must fail a test; coverage is a safety net, not a
  goal. See [Testing](#testing).
- **Built for other self-hosters.** Any OIDC provider, any proxy, SQLite or PostgreSQL, a static
  host with no server at all. Nothing assumes one particular setup; every integration is
  optional and documented.
- **Say why.** Comments and doc comments give the reason and point at the spec
  (`spec: Sharing & Permissions, Friends`, `R-FB-62`, `ADR-0017`), not what the next line does.
- **One copy.** When the same ten lines appear twice, the second copy is a bug waiting to
  diverge. The [shared pieces](#shared-pieces) below exist for that reason; add to them rather
  than beside them.

## What the checks enforce

The hooks run lint-staged (ESLint with fixes, Prettier) and `pnpm typecheck` before each commit,
and `pnpm test:coverage` before each push. CI's `lint` job runs `pnpm lint`, `pnpm format:check`,
`pnpm typecheck`, `pnpm check:version`, `pnpm check:docs` and `pnpm test:scripts`; the other jobs
are in [CI and runners](ci.md). What they stand on:

| Check                             | Where                                               | What it means for the code                                                                                                                                                                                                                                    |
| --------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript strict                 | `web/tsconfig.app.json`                             | `strict`, `noUncheckedIndexedAccess` (every index is `T \| undefined`; a `!` right after an explicit check is the clearest way to say it exists), `exactOptionalPropertyTypes` (spread an optional prop in conditionally, never pass `undefined`), no unused locals or parameters. |
| ESLint                            | `eslint.config.mjs`                                 | `typescript-eslint` strict, React hooks rules, and the boundary: `web/src/core` may not import React, MUI, Emotion, adapters, the app, or `idb`, `ulid`, `ajv`, `zustand`. A file that exports a component exports only components (hooks and helpers go in a `.ts` file next to it). |
| Prettier                          | `.prettierrc`                                       | Single quotes, trailing commas, 100 columns, LF. Markdown, JSON and YAML too. Let it format; do not hand-wrap.                                                                                                                                                                 |
| .NET                              | `server/Directory.Build.props`                      | Nullable on, implicit usings, **warnings are errors**, invariant globalization (no culture-dependent parsing or formatting: `CultureInfo.InvariantCulture` everywhere, and tables instead of Unicode normalization, which is off).                            |
| Line endings and indentation      | `.gitattributes`, `.editorconfig`                   | LF in the repo on every platform; two spaces, four in C#; a final newline.                                                                                                                                                                                    |
| Versions                          | `scripts/check-version.mjs`                         | `web/package.json`, `web/src/core/workspace.ts` and `server/Directory.Build.props` agree; only a release moves them.                                                                                                                                          |
| Docs                              | `scripts/check-docs.mjs`, `mkdocs build --strict`   | Every setting in `SettingsCatalog.cs` has a section in the settings reference; the CLI page matches the usage text; no broken links.                                                                                                                         |

## The web app

### Layers

| Layer          | Holds                                                                                                                        | May import                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `src/core`     | Entities and types, the HLC clock, merge, ordering, migrations, queries, quick add, dates, the palette: pure functions on the workspace. | `core` only. No I/O, no React, no DOM, no library.    |
| `src/ports`    | Interfaces: storage, blobs, sync transport, admin API, validator, ids, date parser, rich text, notifier, QR, native shell.   | `core` types.                                          |
| `src/adapters` | One implementation per port: IndexedDB, HTTP, AJV (compiled at build time), ULID, chrono, Capacitor, memory versions for tests. | `core`, `ports`, its own library.                     |
| `src/app`      | React: the stores, the sync engine, routes, views, dialogs, theme, i18n, icons.                                              | Everything, through the stores and hooks.              |

A core operation has the shape `(ctx: OpContext, workspace: WorkspaceFile) => WorkspaceFile`,
returns the same object when nothing changed, never mutates, and stamps every field it sets with
the clock in `ctx`. The UI runs it through `apply(operation, undoLabel)` on the workspace store;
with a label the change is undoable. Entities are never changed in place: a changed entity is a
new object, which is how saves, the journal and the sync engine tell what moved.

### Habits

- **Every string people see goes through `t()`** with a key in `app/i18n/en.ts`
  (`'admin.link.subject'`: area, then the thing). Sentence case. No em dashes anywhere, in
  strings or docs; a plain dash or a new sentence instead.
- **Icons** are PeckList's own, in `app/icons/icons.tsx` (24 x 24, 1.75 round strokes, no fills,
  `currentColor`). Draw a new one there rather than reach for a Material icon, and swap Material
  icons for ours as a screen is reworked.
- **Clean UI, TickTick's feel**: popovers and icon quick-picks over chips and toggles, no layout
  shifts while something loads, sentence case, nothing that needs a tooltip to be understood.
- **Dates are strings** in the workspace (`YYYY-MM-DD`, `HH:mm`, ISO instants) and the helpers in
  `core/dates.ts` do the arithmetic; the UI formats with the memoized formatters in `app/format.ts`.
  A time zone is part of a schedule, never assumed.
- **Errors say what happened.** `messageOf(error)` (`core/errors.ts`) is the one way to read a
  thrown value; `SyncFailure` carries a `kind` the engine switches on; a caught error that is
  swallowed on purpose gets a comment saying why.
- **Effects that load something** keep a `live` flag and clear it on cleanup (see `useLoaded` in
  `app/admin/useAdmin.ts`), so an unmounted component never sets state.
- **Imports name the file**: `'./foo.ts'`, `'./Bar.tsx'`; named exports; a hook is `useX` in a
  `.ts` file, a component is `PascalCase` in a `.tsx` file, one main component per file.
- **Tests live next to the code** as `name.test.ts(x)`; a UI test goes through `renderApp` and
  `userEvent`, reading the screen as a person would (`getByRole`, `getByLabelText`).

### Shared pieces

Reach for these before writing another copy:

| Piece                                                                       | Use it for                                                                                                                        |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `app/layout/ProblemAlert.tsx`                                               | The red outlined alert under a form for the last refusal; renders nothing when `problem` is null.                                 |
| `app/admin/AdminDialogs.tsx`: `ActionDialog`, `ConfirmDialog`, `SecretDialog` | An admin action with fields and a refusal, an are-you-sure, a password or link shown once with Copy.                            |
| `app/layout/CenteredCard.tsx`                                               | A page that is one card in the middle (sign in, sign up, connect to a server).                                                    |
| `app/sync/passwordChange.ts`, `PasswordChangeFields.tsx`                    | The three fields and the outcome wording of a password change.                                                                    |
| `app/dates/MonthPickerPopover.tsx`, `DatePickerPanel.tsx`                   | Picking a day under a title; the full date and time panel.                                                                        |
| `app/tasks/TaskMenu.tsx`: `PickerDialog`, `MoveToListDialog`                | Pick one thing out of a searched list.                                                                                            |
| `app/layout/BottomSheet.tsx`, `app/views/NarrowButton.tsx`                  | A sheet on phones where a popover sits on desktop.                                                                                |
| `adapters/http-sync.ts`: `send`, `fail`; `http-admin.ts`: `result`, `accept` | Requests with the session cookie and device header; failures as `SyncFailure`; admin refusals as reasons the UI can word.       |
| `app/sync/syncEngine.ts`: `saveMeta`, `tell`                                | Device-local sync progress; what the person is told next.                                                                         |
| `core/collections.ts`, `core/queries.ts`, `core/filters.ts`                 | Finding and filtering entities. Do not scan `workspace.entities.tasks` by hand in the UI.                                         |
| `test/fakeTransport.ts`, `test/renderApp.tsx`, `test/fixtures.ts`           | A fake server with several devices, the app under test, and sample workspaces.                                                    |

## The server

### Layout and style

- `PeckList.Core` is the domain: accounts and sign-in rules, sharing (the `SharingIndex`), sync
  and merge, backups, notifications, settings. It depends on nothing from ASP.NET. `PeckList.Server`
  is the HTTP layer: endpoints, auth, audit, logging, the CLI, the static site.
  `PeckList.Storage.Sql` holds the stores on Dapper, with `Storage.Sqlite` and `Storage.Postgres`
  as thin dialects.
- File-scoped namespaces, primary constructors, `sealed` by default, `record` for anything on the
  wire or in a backup, pattern matching and early returns over nesting, expression bodies where a
  method is one expression. A `///` summary on every public type and member, saying why and
  pointing at the spec.
- Endpoints are `Map*` extension methods per area (`AdminEndpoints`, `BackupEndpoints`, ...),
  minimal API lambdas with their dependencies as parameters. Each takes a `CancellationToken` and
  passes it on. Answers are records; a refusal is `{ error, message? }` with a snake_case code
  (`last_super_admin`, `invalid_username`) that `web/src/adapters/http-admin.ts` maps to a reason
  the UI words. Add the code to both sides.
- Every `/api/admin` endpoint names its permission with `.RequirePermission(...)` (a test checks
  none is left out) and most are `.Audited(...)`. An admin acting on someone else's account goes
  through `AdminEndpoints.OnAccountAsync`, which refuses admins to non-super-admins.
- Time comes from `TimeProvider`, never `DateTimeOffset.UtcNow` (tests use `ManualTime`); dates
  in text use `CultureInfo.InvariantCulture`; a file name's stamp is `TimeStamps.FileStamp`.
- SQL is parameterized Dapper, always. Text columns for times go through `SqlTime`; a unique
  violation is `SqlDatabase.IsUniqueViolation`; an `IN (...)` list is chunked (SQLite allows 999
  parameters); anything the dialects differ on is a property on `SqlDatabase`.
- Logging through `ILogger<T>` with message templates (never string interpolation into the
  template); the `Redaction` masks secrets, but do not log a value that could be one in the first
  place. The generated admin password goes to the console on purpose and nowhere else.

### Shared pieces

| Piece                                                     | Use it for                                                                                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `Core/Tokens.cs`                                          | A random token someone is handed (link, invite, code) and the hash that is stored. Never store a token itself.                              |
| `Core/Sync/ServerEntities.cs`                             | Entities and changes the server writes itself: `New`, `Change`, `Changed`, `Tombstone`, every field stamped from the `ServerClock`. Never build `_hlc` by hand. |
| `Core/Configuration/ServerSettings.Provider(name)`        | The configured OIDC provider by name, or null.                                                                                             |
| `Server/PeriodicService.cs`                               | A background job with a first wait, a gap and a logged failure. Override `RunAsync`; use `Time` and `Logger` from the base.                 |
| `Server/Auth/ReturnUrls.Safe`                             | A return address that may only be a path on this server.                                                                                   |
| `Server/Auth/AppSignIn.ConfirmationPage`                  | A confirm page in the app's own look for a flow that leaves the browser (the Android handoff, the gate).                                    |
| `Server/AdminEndpoints.AccountResult`, `GroupResult`      | The account and group services' exceptions as answers (404, 409, 400).                                                                     |
| `Server/BackupEndpoints.OpenBackup`, `ServerApp.StopSoon` | The backup a restore form names; a restart once the answer is out.                                                                         |
| `Core/Backup/BackupService.ParseAsync`                    | Reading any backup file as JSON, with the right refusal when it is not one.                                                                |
| `Server/Audit`: `context.Audit()`, `.Audited(...)`        | What a request records: who acted, on whom, the outcome and a short detail; never request bodies or task content.                           |

## Security habits

- **Identity and access**: an HttpOnly, SameSite=Lax session cookie checked against the account's
  security stamp, so a disabled account or a changed password ends every session; permissions,
  not role names, at every admin endpoint; a per-address rate limit and a per-account lockout on
  sign-in; super admins only for what would let someone make themselves one.
- **Input at the edge**: ids match `^[0-9A-Za-z_-]{1,64}$`, a file's hash is checked against its
  bytes, an upload is cut off at `ATTACHMENT_MAX_MB` before it is stored, a sync
  push is validated change by change so one bad change never blocks the rest.
- **What goes out**: a strict Content-Security-Policy without `unsafe-eval` (the schema validator
  is compiled at build time), `X-Frame-Options: DENY`, `nosniff`, attachments and provider icons in
  a sandbox, HTML pages built with `WebUtility.HtmlEncode` on every value, return URLs through
  `ReturnUrls.Safe`, and HSTS behind a trusted proxy. The recommended proxy config is
  `reverse_proxy` alone; do not move protections to the proxy.
- **Secrets**: tokens are stored hashed (`Tokens.Hash`), page-saved settings are encrypted at
  rest, logs and audit details go through `Redaction`, the settings page shows `********` for a
  secret whether or not it is set, backups are treated like the database (they hold password
  hashes and signing keys, so whole-server backups are super-admin only).
- **Every refusal has a test**: sign-in while disabled, the last super admin, an admin touching an
  admin, a token used twice, a return URL to another site, a task written by someone who may not.
  When adding a check, add the test that would fail without it.

## Performance habits

- Pages of data, never everything: `SyncService.PageSize` per answer, `MaxChanges` per push, 100
  notifications, 100,000 audit rows at most in a CSV; the client asks again while `more` is set.
- The `SharingIndex` keeps the facts sharing needs in memory, rebuilt on changes, with derived
  lookups (`ILookup`) cached between writes. A new permission rule goes there, not in SQL.
- One request does not scan the store: look at an entity by id, or at the index. Background jobs
  (`PeriodicService`) do the sweeps.
- The build pre-compresses the web app (`web/precompress.ts`, Brotli and gzip at the highest
  setting) and the server sends those; API answers are compressed per request; the event stream
  never is. Keep the main bundle lean: a page only some people open loads on first visit.
- In React, make formatters and heavy derived data once (`useMemo`, `dateTimeFormat` from
  `core/intl.ts` or module-level `Intl` objects), keep render-time work proportional to what is on
  screen, and reveal long lists as they scroll (`useReveal`).
- How the app stays quick at thousands of tasks (storage per record, checking only what changed,
  pages split off the first load and still offline):
  [Staying quick with thousands of tasks](index.md#staying-quick-with-thousands-of-tasks).
- Measure before and after on real-sized data (a copy of the test server's workspace), and put the
  numbers in the merge request.

## Testing

The goal: **no behavior changes without a test failing.** Coverage thresholds
(`web/vite.config.ts`) are a safety net against new code with no tests at all, not a target; do not
write a test to raise the number.

| Change                                            | Tests to touch                                                                                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A core operation or query                         | A unit test in `core/*.test.ts` on inputs and outputs; a property test (fast-check) for an invariant (merge, ordering).                                                  |
| The merge rules                                   | A fixture in `schema/fixtures/merge`; both suites run it.                                                                                                                |
| The schema                                        | Bump `schemaVersion`, a migration, fixtures in `schema/fixtures/migrations`, `docs/migrations/<N>.md`.                                                                   |
| A port or adapter                                 | The port's contract suite (`adapters/*.contract.ts`), run by every adapter including the memory one.                                                                     |
| A screen or dialog                                | A `*.ui.test.tsx` through `renderApp`: what the person sees and can do, not component internals.                                                                         |
| A server rule                                     | `PeckList.Core.Tests` for the rule on its own, `PeckList.Server.Tests` over HTTP through `WebApplicationFactory` for the endpoint (both SQLite and, where it matters, PostgreSQL). |
| A store                                           | The store contract in `PeckList.Storage.Tests`, run on SQLite and PostgreSQL.                                                                                           |
| A critical flow (sign in, sync between devices, sharing) | An end-to-end spec in `e2e/` (`pnpm e2e`, and `e2e:server` against a real server).                                                                                 |

Test names read as sentences about behavior (`it('offers each provider beside the password form')`),
set up through the public surface (fixtures, the HTTP API, the fake transport), and assert what a
person or another device would observe. Prefer one clear `expect` of the outcome over asserting
each intermediate state.

## Commits and merge requests

- Trunk-based: a short branch, squash-merged into a protected `main`; `main` always builds and
  passes. Pushes to other branches start no pipeline; open a merge request.
- Conventional Commits with a scope (`feat(calendar):`, `fix(sync):`, `refactor(server):`), a
  summary under 72 characters written for the changelog reader, a body that says what changed and
  why, and `Refs: PL-xxx` naming the feature note. Breaking changes carry `!` and a
  `BREAKING CHANGE:` footer with the upgrade path; a change that needs a newer Android app or
  drops old web apps carries `Requires-Android:` or `Supports-Web:` ([releasing](releasing.md#compatibility)).
- A merge request says what to look at and ends with a numbered **What to test** list someone
  can follow on the test server. A large refactor lands as one commit per reviewable group.
- A setting, a CLI change, a new endpoint or anything a self-hoster will notice comes with its
  docs page in the same change; CI checks the settings and CLI pages.
- The feature note in the project notes is updated when the work lands (checkboxes, status, the
  progress log); the merge request links it.

## Documentation

- Written for the person running or using PeckList: plain words, short sentences, the reason
  behind each recommendation, and an honest **needed / recommended / optional / not needed**
  sorting where settings are involved. No em dashes.
- `docs/` is the MkDocs site (`mkdocs serve`; `mkdocs build --strict` in CI); `CONTRIBUTING.md`,
  `SECURITY.md` and `CHANGELOG.md` are read on GitLab; `CLAUDE.md` and this page are for whoever
  (or whatever) writes code.
- Keep examples real: a `Caddyfile` under `examples/` is tested against a running image before it
  is recommended.

## Before opening a merge request

1. `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test` (the hooks run most of this).
2. `cd server && dotnet test` when the server changed (Docker running, for PostgreSQL).
3. `pnpm build && pnpm e2e` when a flow changed.
4. `pnpm check:docs` after a setting or CLI change; `mkdocs build --strict` after a docs change.
5. Read the diff once as a reviewer: is anything copied that a shared piece covers, is every new
   refusal tested, does every new string go through `t()`, does the commit message tell the
   changelog reader what changed?
