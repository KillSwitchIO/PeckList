# Developing

How the code is organised and how to work on it. Conventions (branches, commits, architecture rules,
testing) are in [CONTRIBUTING.md](https://gitlab.com/killswitch10/punchlist/-/blob/main/CONTRIBUTING.md).

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
`mise.toml`: `mise install`. Docker for the PostgreSQL tests and the image. Chrome and Firefox for
end-to-end tests.

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
```

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
