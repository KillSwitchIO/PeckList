// Prepare a release on main: bump the version everywhere, regenerate CHANGELOG.md from the
// Conventional Commits since the last tag, commit, and make the annotated tag. Nothing is pushed.
//   pnpm release                  (the next version by the rule below, tagged v<it>+<today>, UTC)
//   pnpm release 0.2.0            (that version, if the rule allows it)
//   pnpm release 0.2.0-rc.1       (a pre-release: no `latest` image, marked upcoming)
//   pnpm release 0.2.0 --dry-run  (show the changelog section, change nothing)
// Then: git push origin main --follow-tags   (CI builds, publishes and releases the tag)
// Through a merge request instead: on a branch, `pnpm release 0.2.0 --any-branch --no-tag`, push,
// merge, then `pnpm release:tag` on main (scripts/tag-release.mjs).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { versionDocs } from './docs-version.mjs';
import { releaseNotes } from './release-notes.mjs';
import { SEMVER, nextVersion, readVersions, root, writeVersion } from './versions.mjs';

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
  });

if (asked && !SEMVER.test(asked)) {
  fail('Usage: pnpm release [<version>] [--dry-run]   e.g. pnpm release, or pnpm release 1.0.0');
}
const current = readVersions()[0].version;

// The version follows what the release holds (Ben, 2026-10-30): any feature since the last tag
// makes it a minor release (0.3.0), only fixes and dependency bumps a patch (0.2.11). A major
// (1.0.0) is always asked for by name; a pre-release must be of the version the rule gives.
const lastTag = (() => {
  try {
    return git('describe', '--tags', '--abbrev=0', '--match', 'v*');
  } catch {
    return null;
  }
})();
const messages = git(
  'log',
  '--no-merges',
  '--format=%B%x00',
  ...(lastTag ? [`${lastTag}..HEAD`] : []),
)
  .split('\0')
  .map((message) => message.trim())
  .filter(Boolean);
const expected = nextVersion(current, messages);
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

if (dryRun) {
  console.log(cliff('--unreleased', '--tag', tag, '--strip', 'header'));
  console.log(`Would release ${current} -> ${version} as ${tag}.`);
  process.exit(0);
}

writeVersion(version);
// A release gets its own copy of the docs (docs.pecklist.com shows the newest); a pre-release does not.
const docsVersion = !version.includes('-');
if (docsVersion) versionDocs(version);
cliff('--tag', tag, '--output', 'CHANGELOG.md');
const notes = releaseNotes(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), version) ?? '';
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
  console.log(`Committed ${version}. Push the branch, merge it, then: pnpm release:tag on main.`);
} else {
  git('tag', '-a', tag, '-m', `PeckList ${version}\n\n${notes}`);
  console.log(`Tagged ${tag}. Review the commit, then: git push origin main --follow-tags`);
}
