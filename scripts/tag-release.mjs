// Tag a release that reached main through a merge request (`pnpm release <version> --no-tag` on a
// branch, merged): checks main is up to date and holds that version, then makes the annotated tag
// with the changelog section as its message. Nothing is pushed.
//   pnpm release:tag            (the version the files hold)
//   pnpm release:tag --dry-run
//   pnpm release:tag --skip-pipeline-check   (tag a commit main's pipeline has not passed)
// Then: git push origin <tag>   (CI builds, publishes and releases the tag)

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { releaseNotes } from './release-notes.mjs';
import { readVersions, root } from './versions.mjs';

const dryRun = process.argv.includes('--dry-run');
const fail = (message) => {
  console.error(message);
  process.exit(1);
};
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

const versions = [...new Set(readVersions().map((each) => each.version))];
if (versions.length !== 1) fail(`The version differs between files: ${versions.join(', ')}`);
const [version] = versions;
if (git('tag', '--list', `v${version}+*`)) fail(`${version} is already tagged.`);
if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') fail('Release tags go on main.');
if (git('status', '--porcelain')) fail('Commit or stash your changes first.');
const sha = git('rev-parse', 'HEAD');
if (!process.argv.includes('--skip-pipeline-check')) {
  // The tag's pipeline builds and publishes without re-testing, so the commit must have been
  // tested as main (the project is public, so the API needs no token).
  const pipelines = await fetch(
    `https://gitlab.com/api/v4/projects/killswitch10%2Fpunchlist/pipelines?sha=${sha}&ref=main`,
  ).then((response) => (response.ok ? response.json() : []));
  const green = pipelines.some((pipeline) => pipeline.status === 'success');
  if (!green) {
    fail(
      `No green main pipeline for ${sha.slice(0, 8)} (${pipelines.map((p) => p.status).join(', ') || 'none found'}). ` +
        'Wait for it, or pass --skip-pipeline-check if you know better.',
    );
  }
}
const notes = releaseNotes(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), version);
if (notes === null) fail(`CHANGELOG.md has no section for ${version}: run pnpm release first.`);
const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
const tag = `v${version}+${date}`;

if (dryRun) {
  console.log(`Would tag ${git('rev-parse', '--short', 'HEAD')} as ${tag}:\n\n${notes}`);
  process.exit(0);
}
git('tag', '-a', tag, '-m', `Punchlist ${version}\n\n${notes}`);
console.log(`Tagged ${tag}. Then: git push origin ${tag}`);
