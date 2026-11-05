# Contributing

The workflow is below. The coding standards (layers, style, the checks, shared pieces, security
and performance habits, what to test) are in
[docs/development/standards.md](docs/development/standards.md); read it before a change.

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md). New here? Issues labelled
[`good first issue`](https://gitlab.com/killswitch10/pecklist/-/issues/?label_name%5B%5D=good%20first%20issue)
are small and well described, and
[`help wanted`](https://gitlab.com/killswitch10/pecklist/-/issues/?label_name%5B%5D=help%20wanted)
ones are where a hand is most welcome. Say on the issue that you are taking it, so two people do
not do the same work.

Changes, issues and reviews happen on GitLab,
[gitlab.com/killswitch10/pecklist](https://gitlab.com/killswitch10/pecklist). The GitHub
repository [KillSwitchIO/PeckList](https://github.com/KillSwitchIO/PeckList) is a one-way mirror
of `main` and the release tags: pull requests opened there are closed automatically with a
pointer back here.

## License and contributions

PeckList is released under the [AGPL-3.0-or-later](LICENSE). To keep the project able to offer a
[commercial license](COMMERCIAL-LICENSE.md) alongside it, contributions come in under a more
permissive license than the one the project ships with:

- **By submitting a contribution you license it to the project under the
  [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).** The project redistributes it
  under the AGPL-3.0-or-later, and may also do so under the commercial license. You keep the
  copyright and may use your own work however you like.
- **Sign off every commit** (`git commit -s`, which adds `Signed-off-by: Name <email>`). The
  sign-off records that you wrote the change or have the right to submit it under these terms, in
  the sense of the [Developer Certificate of Origin](https://developercertificate.org/), and that
  you agree to the grant above. If your employer owns your work, make sure they allow it.
- Third-party code and assets come with a compatible license (MIT, BSD, ISC, Apache-2.0 and the
  like) and keep their notices. GPL-only or noncommercial-only material cannot be merged.

## Branching (trunk-based)

- `main` is always releasable. Every commit on it passes lint, typecheck, tests and build.
- Work on short-lived branches (hours to two days): `feat/`, `fix/`, `docs/`, `test/`, `refactor/`, `chore/`, `ci/` plus a slug, e.g. `feat/pl-022-quick-add`.
- Merge by squash. A merge request must be up to date with `main`: rebase, and its pipeline runs
  again, so what merges is what passed.
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

The documentation site lives in `docs/` (Docusaurus, built from `website/`; see [developing](docs/development/index.md)). A change people will notice comes with its docs:

- A new or changed setting: its section in `docs/configuration/reference.md`. `pnpm check:docs` (also in CI) fails when a setting in `SettingsCatalog.cs` is missing there.
- A CLI change: run `node scripts/check-docs.mjs --write` to refresh the usage text, and describe the command in `docs/reference/cli.md`.

## Releases

See [releasing](docs/development/releasing.md). The changelog is generated from the commits, so write commit summaries for the people who will read it.

## Line endings

LF everywhere (`.gitattributes`). Windows and Linux are both supported development platforms.
