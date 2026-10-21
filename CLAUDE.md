# CLAUDE.md

Guidance for Claude Code in this repo. The product spec, roadmap, decisions (ADR-xxxx) and feature notes (PL-xxx) live in Ben's Obsidian vault at `C:\Users\KillSwitch\Syncthing\obsidian\KillSwitch\Punchlist\`. Read the relevant feature note before starting work and update it (checkboxes, `status`, hub progress log) when work lands.

## Commands

Toolchain: Node 24 LTS + pnpm via `mise.toml`. In Git Bash on Windows, mise's node may lose to another node on PATH; prepend the mise install dirs if `node --version` is not 24.

```bash
pnpm install
pnpm dev            # http://localhost:6173 (5173 is often inside a Windows-reserved port range)
pnpm test
pnpm test:coverage
pnpm build && pnpm e2e
pnpm lint && pnpm typecheck
```

## Dev server gotcha

Vite's native file watcher on Windows missed edits (git branch switches, scripted multi-file edits, and the pre-commit hook, which briefly rewrites staged files), leaving the browser on stale code while tests pass. `vite.config.ts` now polls on Windows; a server started before that change needs one restart. Still, before reporting a UI change as verified, fetch the module from the dev server (`/src/...`) after committing and check it contains the change; if not, restart with `pnpm --dir web dev --force`. String catalog edits hot-apply (`i18n.ts` accepts `en.ts`); still check the browser console for errors.

## Rules

- Ports and adapters: `web/src/core` must not import UI libraries, adapters or third-party packages (ESLint enforces). New libraries go behind a port in `web/src/ports` with an adapter in `web/src/adapters` and a contract suite.
- Schema changes: bump `schemaVersion`, add a migration, fixtures and `docs/migrations/<N>.md`.
- Merge changes must keep `schema/fixtures/merge` passing; add a fixture for any new rule.
- Tests pin behavior. Coverage thresholds are a safety net, not a target; do not chase the number.
- Trunk-based: short branches, squash merges, Conventional Commits with `Refs: PL-xxx`. Local commits only; never push unless Ben asks.
- All user-facing strings go through `t()` in `web/src/app/i18n`.
- Never use em dashes in docs or UI copy.
- Do not assume Ben's homelab: the app is self-hosted by others with any OIDC provider, proxy and database.
