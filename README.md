# Punchlist

A self-hostable, offline-first task and calendar app. Runs standalone in the browser as an installable PWA against a local JSON document, or (from milestone 0.4) syncs through a single lightweight Docker container that also serves the web app.

> Status: **0.1 Foundations** - early development. Not ready for real data yet.

## Highlights (planned for 1.0)

- Tasks with subtasks, tags, priorities, markdown notes, schedules (start, end, all-day) and hard due dates
- List, smart views (Today, Next 7 days, Inbox ...), calendar month/week/day with drag and resize, timeline
- Works offline everywhere; conflict-free merge between devices and users
- Sharing: friends, groups, shared lists, single-task sharing
- Self-hosting: one container, SQLite by default or PostgreSQL, optional OIDC with any provider

## Repository layout

| Path      | What                                                        |
| --------- | ----------------------------------------------------------- |
| `web/`    | React + TypeScript PWA                                      |
| `schema/` | JSON Schema for the workspace file and shared test fixtures |
| `e2e/`    | WebdriverIO end-to-end tests (system-installed browsers)    |
| `docs/`   | Schema, migrations and (later) self-hosting docs            |
| `server/` | ASP.NET Core server (milestone 0.4)                         |

## Development

Requirements: Node.js 24 LTS and pnpm (both pinned in `mise.toml`; `mise install` sets them up), Chrome and/or Firefox for end-to-end tests.

```bash
pnpm install
pnpm dev            # http://localhost:6173
pnpm test           # unit and component tests
pnpm test:coverage  # with coverage thresholds
pnpm e2e            # builds nothing: run `pnpm build` first; starts vite preview and runs WebdriverIO
pnpm lint
pnpm typecheck
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the branching model, commit conventions and testing approach.

## License

To be decided before the first public release.
