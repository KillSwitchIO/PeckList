# Developing

How the code is organised and how to work on it. Conventions (branches, commits, architecture rules,
testing) are in [CONTRIBUTING.md](https://gitlab.com/killswitch10/punchlist/-/blob/main/CONTRIBUTING.md);
the house style, the checks and the shared pieces to reach for are in [Coding standards](standards.md).

## Layout

| Path        | What                                                                                                                                                              |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web/`      | The React + TypeScript web app (PWA). `src/core` is the domain, `src/ports` the interfaces, `src/adapters` their implementations, `src/app` the UI.               |
| `server/`   | The ASP.NET Core server: `src/Punchlist.Core` (domain), `Punchlist.Server` (HTTP, auth, logging, CLI), `Punchlist.Storage.*` (SQL, SQLite, PostgreSQL); `tests/`. |
| `schema/`   | The workspace JSON Schema and fixtures both sides must pass (merge, migrations).                                                                                  |
| `e2e/`      | WebdriverIO end-to-end tests in real browsers.                                                                                                                    |
| `docs/`     | This site (MkDocs).                                                                                                                                               |
| `examples/` | Compose files, a settings file, proxy configs, service files.                                                                                                     |
| `scripts/`  | Release, packaging and checks.                                                                                                                                    |

## Setting up

Node.js 24 with pnpm, and the .NET 10 SDK. [mise](https://mise.jdx.dev/) installs both from
`mise.toml`: `mise install`. Docker for the PostgreSQL tests and the image (or set
`PUNCHLIST_TEST_POSTGRES` to a connection string for a PostgreSQL server the tests may create
databases on). Chrome and Firefox for end-to-end tests.

```bash
pnpm install           # also installs the git hooks
```

## Web app

```bash
pnpm dev               # http://localhost:6173, standalone (no server)
pnpm test              # unit and component tests (Vitest)
pnpm test:coverage     # with the coverage safety net
pnpm lint && pnpm typecheck
pnpm build && pnpm e2e # end-to-end, against a production build
# two devices through a real server (any running image, its ADMIN_PASSWORD given):
E2E_BASE_URL=http://localhost:6183 E2E_ADMIN_PASSWORD=... pnpm e2e:server
# the web client's own code (store, sync engine, HTTP) as several people against a real server:
# friends, groups, sharing, hand-over, account removal, refusals, concurrent edits
PUNCHLIST_URL=http://localhost:6183 PUNCHLIST_ADMIN_PASSWORD=... pnpm --filter @punchlist/web exec vitest run src/integration
```

The `src/integration` tests are skipped unless `PUNCHLIST_URL` is set. Run them against a fresh
server: each run adds accounts.

### Staying quick with thousands of tasks

A real workspace of 4,500 tasks is about 9 MB of JSON, most of it per-field clocks. What keeps the
app quick at that size, and what to keep in mind when changing it:

- **Storage, one record per entity.** `adapters/indexeddb-storage.ts` keeps each entity as its own
  IndexedDB record (database `punchlist-records`) plus a small header with the workspace fields
  and each collection's order. A save writes the entities that are new objects since storage was
  last read or written: entities are never changed in place, so a changed one is a new object. A
  workspace an older version saved as one JSON text is read once and moved over on the next save.
- **No read-back while no other tab saved.** Each save leaves a stamp (`meta:workspace-generation`).
  While the stamp is still this tab's own, the store saves without reading storage back and
  merging. Other tabs' saves arrive on the `punchlist` BroadcastChannel, heard only on the channel
  the tab saves on (a channel never hears itself).
- **Data from the server is checked by what changed.** `keepValid` validates the changed entities
  only, and the clock moves on from those alone (`changedEntities`, `maxHlcOf`).
- **Formatters and day lookups are made once.** Use `dateTimeFormat` (`core/intl.ts`), not
  `new Intl.DateTimeFormat`, in anything that runs per task, and `localDayOf` for the local day of
  an instant (closed tasks' days are asked for on every render).
- **Long lists draw as they scroll near.** `useReveal` (`app/views/useReveal.tsx`) draws the first
  rows, adds more while the end is still screens away, and keeps a spacer for the rest so the
  scroll bar is the whole list's. The Closed page and a list's Completed group use it.
- **Pages split off the first load.** Settings, admin, the calendar, friends, stats and
  notifications load on first visit (`app/lazyPages.ts`, React's `lazy`), the notes editor on first
  use. Once the app is idle it fetches them all ahead, and the service worker precaches every
  chunk, so they open offline and with no server too. A test that opens one of these pages waits
  for it (`findBy...`), as a page loading on first visit is drawn a moment later.
- **A sync's run of data-only pages is taken in together** (up to 5,000 entities or 1.5 s), one
  render and one save instead of one per page; where the sync stands is saved only with the data it
  stands for. The server sends 2,000 entities a page.

To measure, load a copy of real data (an exported workspace, or a server snapshot imported into a
throwaway container) and watch the main thread for blocks over 50 ms while doing the slow thing;
`docs/` has no numbers to keep up to date on purpose, the vault's performance notes do.

## Server

```bash
cd server
dotnet test                                     # unit and integration tests (Docker for PostgreSQL)
WEB_ROOT=../web/dist dotnet run --project src/Punchlist.Server   # serves the built web app too
```

## Docs

```bash
pip install -r docs/requirements.txt
mkdocs serve           # http://localhost:8000, reloads on save
pnpm check:docs        # the settings and CLI pages cover everything
```

Adding a setting means a line in `SettingsCatalog.cs` **and** a section in
`docs/configuration/reference.md`; changing the CLI's usage text means running
`node scripts/check-docs.mjs --write`. CI fails otherwise.

## Checks before pushing

The hooks run them: lint-staged and typecheck before each commit, the unit tests with coverage
before each push. CI runs everything again, plus the server tests, end-to-end tests, the docs build
and the image build. See [CI and runners](ci.md).
