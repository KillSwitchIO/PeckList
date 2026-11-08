// Make a release's commit: bump the version everywhere, add its section to CHANGELOG.md from the
// Conventional Commits it holds, copy the docs, commit. The usual way is the prepare-release button,
// which runs this and opens the merge request (docs/development/releasing.md). Nothing is pushed.
//   pnpm release                  (the next version by the rule below, tagged v<it>+<today>, UTC)
//   pnpm release 0.2.0            (that version, if the rule allows it)
//   pnpm release 0.2.0-rc.1       (a pre-release: no `latest` image, marked upcoming)
//   pnpm release 0.2.0 --dry-run  (show the changelog section, change nothing)
// By hand: on a branch, `pnpm release --any-branch --no-tag`, push, and open the merge request titled
// chore(release): <version>. Merging builds the image; publishing is the cut-release button.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { versionDocs } from './docs-version.mjs';
import { releaseNotes, withSection } from './release-notes.mjs';
import { SEMVER, plannedVersion, readVersions, root, writeVersion } from './versions.mjs';

const args = process.argv.slice(2);
const asked = args.find((arg) => !arg.startsWith('--'));
const dryRun = args.includes('--dry-run');
const anyBranch = args.includes('--any-branch');
const noTag = args.includes('--no-tag');

const fail = (message) => {
  console.error(message);
  process.exit(1);
};
const git = (...gitArgs) => execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8' }).trim();
const cliff = (...cliffArgs) =>
  execFileSync('pnpm', ['exec', 'git-cliff', ...cliffArgs], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    // Pre-release tags are not boundaries inside the range (see `since` below). From the
    // environment, so cmd on Windows leaves the pattern alone.
    env: { ...process.env, GIT_CLIFF_IGNORE_TAGS: String.raw`^v[0-9]+\.[0-9]+\.[0-9]+-` },
  });

if (asked && !SEMVER.test(asked)) {
  fail('Usage: pnpm release [<version>] [--dry-run]   e.g. pnpm release, or pnpm release 1.0.0');
}
const current = readVersions()[0].version;

// The version follows what the release holds (Ben, 2026-10-30): any feature since the last tag
// makes it a minor release (0.3.0), only fixes and dependency bumps a patch (0.2.11). A major
// (1.0.0) is always asked for by name; a pre-release must be of the version the rule gives.
const lastTagOf = (...describeArgs) => {
  try {
    return git('describe', '--tags', '--abbrev=0', '--match', 'v*', ...describeArgs);
  } catch {
    return null;
  }
};
const lastTag = lastTagOf();
const messages = git(
  'log',
  '--no-merges',
  '--format=%B%x00',
  ...(lastTag ? [`${lastTag}..HEAD`] : []),
)
  .split('\0')
  .map((message) => message.trim())
  .filter(Boolean);
const expected = plannedVersion(current, messages, Boolean(git('tag', '--list', `v${current}+*`)));
const features = messages.filter((message) => /^feat(\([^)]*\))?!?:/.test(message));
const coreOf = (value) => value.replace(/-.*/, '');
const majorOf = (value) => Number(value.split('.')[0]);
const version = asked ?? expected;
if (asked && coreOf(asked) !== expected && majorOf(asked) <= majorOf(current)) {
  fail(
    `${asked} does not fit this release: since ${lastTag ?? 'the start'} it has ` +
      (features.length
        ? `${features.length} feature(s), so it is ${expected} (a minor release), e.g. ${features[0].split('\n')[0]}`
        : `no features, so it is ${expected} (a patch release)`) +
      '. Run pnpm release with no version, or name a major (1.0.0).',
  );
}
const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
const tag = `v${version}+${date}`;

if (git('tag', '--list', `v${version}+*`)) fail(`${version} is already tagged.`);
if (!dryRun) {
  if (git('status', '--porcelain')) fail('Commit or stash your changes first.');
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  if (branch !== 'main' && !anyBranch) fail(`Releases are tagged on main (this is ${branch}).`);
}

// The changelog section. A pre-release holds the commits since the tag before it. A full release
// holds everything since the last full release, so 0.9.0 repeats what its own 0.9.0-rc.1 and
// rc.2 said: the release before it is 0.8.0, whatever was tried on the way. Each pre-release keeps
// its own section too. The file only grows, a section at a time: regenerating it all from the tags would cut 0.9.0 back to
// the commits after its last release candidate.
const since = version.includes('-') ? lastTag : lastTagOf('--exclude', 'v*-*');
const section = cliff('--tag', tag, '--strip', 'header', ...(since ? [`${since}..HEAD`] : []));
if (!section.trim()) {
  fail(
    `Nothing since ${since ?? 'the start'} goes in the changelog (feat, fix, perf, security, docs, ` +
      'refactor or a breaking change), so there is nothing to release.',
  );
}

if (dryRun) {
  console.log(section);
  console.log(`Would release ${current} -> ${version} as ${tag}.`);
  process.exit(0);
}

writeVersion(version);
// A release gets its own copy of the docs (docs.pecklist.com shows the newest); a pre-release does not.
const docsVersion = !version.includes('-');
if (docsVersion) versionDocs(version);
const changelogPath = join(root, 'CHANGELOG.md');
writeFileSync(changelogPath, withSection(readFileSync(changelogPath, 'utf8'), version, section));
const notes = releaseNotes(readFileSync(changelogPath, 'utf8'), version) ?? '';
git(
  'add',
  'CHANGELOG.md',
  'web/package.json',
  'web/src/core/workspace.ts',
  'server/Directory.Build.props',
  ...(docsVersion
    ? ['website/versions.json', 'website/versioned_docs', 'website/versioned_sidebars']
    : []),
);
git('commit', '-m', `chore(release): ${version}`);
if (noTag) {
  console.log(
    `Committed ${version}. Push the branch and merge it, then press cut-release on its main pipeline.`,
  );
} else {
  git('tag', '-a', tag, '-m', `PeckList ${version}\n\n${notes}`);
  console.log(`Tagged ${tag}. Review the commit, then: git push origin main --follow-tags`);
}
