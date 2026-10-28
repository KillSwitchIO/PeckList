# Contributing

The workflow is below. The coding standards (layers, style, the checks, shared pieces, security
and performance habits, what to test) are in
[docs/development/standards.md](docs/development/standards.md); read it before a change.

## Branching (trunk-based)

- `main` is always releasable. Every commit on it passes lint, typecheck, tests and build.
- Work on short-lived branches (hours to two days): `feat/`, `fix/`, `docs/`, `test/`, `refactor/`, `chore/`, `ci/` plus a slug, e.g. `feat/pl-022-quick-add`.
- Merge by squash. Rebase on `main` first; no merge commits on `main`.
- Unfinished work merges behind a feature flag rather than living on a long branch.
- No release branches. Only the latest release is supported; fixes go forward on `main`.
- Releases are tags on `main`: `vX.Y.Z+YYYYMMDD` (date as SemVer build metadata).

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), summary under 72 characters:

```
feat(calendar): resize time ranges by dragging the block edge

Refs: PL-021
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`, `ci`, `build`. Mark breaking changes with `feat!:` or a `BREAKING CHANGE:` footer and describe the upgrade path. `Refs:` points at the feature id (`PL-xxx`). `Requires-Android: X.Y.Z` and `Supports-Web: X.Y.Z` footers put a Compatibility note in the next release's changelog ([releasing](docs/development/releasing.md#compatibility)).

## Architecture rules

- **Ports and adapters.** `web/src/core` holds the domain (entities, HLC, merge, ordering, migrations, palette) and imports no UI library, no adapter and no third-party package directly. It talks to the outside world through interfaces in `web/src/ports`. Implementations live in `web/src/adapters`. ESLint enforces the boundary.
- Every port has a **contract test suite** (e.g. `adapters/storage.contract.ts`); every adapter must pass it. Swapping a library means writing a new adapter that passes the same suite.
- The data contract is `schema/workspace.schema.json`. Any change bumps `schemaVersion`, adds a migration in `web/src/core/migrations.ts`, fixtures in `schema/fixtures/migrations/` and a note in `docs/migrations/`.
- Merge behavior is pinned by the fixtures in `schema/fixtures/merge/`. The server implementation must pass the same files.

## Testing

The goal is that **no behavior changes without a test failing**. Coverage is not the target:

- Test behavior, not implementation details: inputs and outputs of the domain, what the user sees and can do in the UI.
- Shared fixtures (merge, migrations, schema) and contract suites pin down behavior that other implementations must match.
- Property-based tests (fast-check) cover the merge and ordering invariants.
- End-to-end tests cover the critical user flows in real browsers.
- Coverage thresholds in `web/vite.config.ts` are a modest safety net that flags new code arriving with no tests at all. Do not write tests just to raise the number.

Git hooks (installed by `pnpm install`): pre-commit runs lint-staged and typecheck; pre-push runs the unit tests with coverage thresholds.

## Docs

The documentation site lives in `docs/` (MkDocs, see [developing](docs/development/index.md)). A change people will notice comes with its docs:

- A new or changed setting: its section in `docs/configuration/reference.md`. `pnpm check:docs` (also in CI) fails when a setting in `SettingsCatalog.cs` is missing there.
- A CLI change: run `node scripts/check-docs.mjs --write` to refresh the usage text, and describe the command in `docs/reference/cli.md`.

## Releases

See [releasing](docs/development/releasing.md). The changelog is generated from the commits, so write commit summaries for the people who will read it.

## Line endings

LF everywhere (`.gitattributes`). Windows and Linux are both supported development platforms.
