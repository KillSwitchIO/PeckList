// Prepare a release on main: bump the version everywhere, regenerate CHANGELOG.md from the
// Conventional Commits since the last tag, commit, and make the annotated tag. Nothing is pushed.
//   pnpm release 0.2.0            (tag v0.2.0+<today>, UTC)
//   pnpm release 0.2.0-rc.1       (a pre-release: no `latest` image, marked upcoming)
//   pnpm release 0.2.0 --dry-run  (show the changelog section, change nothing)
// Then: git push origin main --follow-tags   (CI builds, publishes and releases the tag)

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { releaseNotes } from './release-notes.mjs';
import { SEMVER, readVersions, root, writeVersion } from './versions.mjs';

const args = process.argv.slice(2);
const version = args.find((arg) => !arg.startsWith('--'));
const dryRun = args.includes('--dry-run');
const anyBranch = args.includes('--any-branch');

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

if (!version || !SEMVER.test(version)) {
  fail('Usage: pnpm release <version> [--dry-run]   e.g. pnpm release 0.2.0');
}
const current = readVersions()[0].version;
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
cliff('--tag', tag, '--output', 'CHANGELOG.md');
const notes = releaseNotes(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), version) ?? '';
git(
  'add',
  'CHANGELOG.md',
  'web/package.json',
  'web/src/core/workspace.ts',
  'server/Directory.Build.props',
);
git('commit', '-m', `chore(release): ${version}`);
git('tag', '-a', tag, '-m', `Punchlist ${version}\n\n${notes}`);
console.log(`Tagged ${tag}. Review the commit, then: git push origin main --follow-tags`);
