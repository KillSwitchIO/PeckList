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
  A merge request from a fork fails its `signoff` job until every commit carries a sign-off whose
  email is the commit author's: `git commit --amend -s` fixes the last commit, and
  `git rebase --signoff <base>` all of them, with the base the job prints (or `upstream/main`).
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
- A CLI change: for the server's maintenance commands, run `node scripts/check-docs.mjs --write` to refresh the usage text and describe the command in `docs/reference/cli.md`. The client commands come from `server/src/PeckList.Client/CommandTable.cs`: after changing it, run `PECKLIST_WRITE_GENERATED=1 dotnet test tests/PeckList.Client.Tests --filter CommandTableTests` in `server/` to refresh their docs section and completion scripts.
- An HTTP API change: refresh the committed OpenAPI document with `PECKLIST_WRITE_GENERATED=1 dotnet test tests/PeckList.Server.Tests --filter FullyQualifiedName~The_committed_document` in `server/`, and commit `docs/reference/openapi.json`.

## Translations

PeckList's text lives in three catalogs, each with English as the source:

| Part                                          | English                                              | A translation                              |
| --------------------------------------------- | ---------------------------------------------------- | ------------------------------------------ |
| Web app                                       | `web/src/app/i18n/locales/en.json`                   | `<tag>.json` beside it, loaded when picked |
| Server (emails, pushes, the Android check-in) | `server/src/PeckList.Core/Text/locales/en.json`      | `<tag>.json` beside it, embedded at build  |
| Android app                                   | `mobile/android/app/src/main/res/values/strings.xml` | `res/values-<tag>/strings.xml`             |

The web and server catalogs are flat JSON in ICU MessageFormat: `{name}` fills a parameter,
`{count, plural, one {# task} other {# tasks}}` picks the form the language's plural rules ask for,
and `select` picks by a value. Keys ending in `Pattern` in the server catalog are date patterns
(`YYYY`, `MMMM`, `MMM`, `D`, `dddd`, `ddd`, literal text in `[brackets]`): reorder the tokens and
leave them as they are.

When translating:

- Keep every `{parameter}` and the plural or select structure; translate only the words. Use the
  plural categories your language has (`one`, `few`, `many`, `other`), and keep any `=0` or `=1`.
- A plain `'` before `{` starts quoting in ICU and breaks the message: use the typographic `’`.
- Sentence case, no em dashes, short labels on buttons and in the sidebar, product names as they are.
- In a new language a key may be left out: it shows in English until it is translated. German,
  Spanish and French ship whole, so a new English string comes with those three too (a draft is
  fine; say so in the merge request).

To add a language:

1. Copy each catalog to the new tag (`pt-BR.json`, `values-pt-rBR`) and translate it.
2. Add MUI's locale object for it to `MUI_LOCALES` in `web/src/app/theme/theme.ts`.
3. While no person has checked a machine draft, list it in `MACHINE_TRANSLATED`
   (`web/src/app/i18n/language.ts`), so the picker says so. Remove it once someone has.

The checks run in CI. `pnpm check:i18n` fails on invalid ICU, on a translation whose parameters
differ from English, on a translated key English no longer has, on English keys nothing uses, and
on a key German, Spanish or French lacks; it also reports each language's coverage. A count may change shape between languages (a plain
number in English, a plural in yours) only for parameters named like counts (`count`, `days`,
`hours` and so on, in `COUNT_NAMES` in `scripts/check-i18n.mjs`); add a name there when a new one
needs it. The lint rule `pecklist/no-literal-ui-text` flags text left in JSX, and Android lint
(`pnpm --filter @pecklist/mobile test:android`) fails on text written into a layout, a translation
of a string English lacks, and placeholders that differ.

## Releases

See [releasing](docs/development/releasing.md). The changelog is generated from the commits, so write commit summaries for the people who will read it.

## Line endings

LF everywhere (`.gitattributes`). Windows and Linux are both supported development platforms.
