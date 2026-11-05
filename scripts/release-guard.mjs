// A release/* merge request runs no test suites, because it changes no code: its tree is the last
// tested one plus a version number, the changelog and a copy of the docs. This job is what makes
// that true: it fails when the diff holds anything else, so the branch name cannot dodge the tests.
//   node scripts/release-guard.mjs   (in a merge request pipeline)

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { readVersions, root } from './versions.mjs';

const VERSION_FILES = new Set([
  'web/package.json',
  'web/src/core/workspace.ts',
  'server/Directory.Build.props',
]);
const OTHER_PATHS = [
  /^CHANGELOG\.md$/,
  /^website\/versions\.json$/,
  /^website\/versioned_docs\//,
  /^website\/versioned_sidebars\//,
];

/**
 * What is wrong with a release merge request; empty when nothing is.
 * @param {object} input
 * @param {{ path: string, added: number, removed: number }[]} input.changes the diff's numstat
 * @param {string} input.title the merge request's title
 * @param {string[]} input.versions the version each version file holds
 */
export function releaseProblems({ changes, title, versions }) {
  const problems = [];
  const unique = [...new Set(versions)];
  if (unique.length !== 1) problems.push(`The version files differ: ${unique.join(', ')}.`);
  if (title !== `chore(release): ${unique[0]}`) {
    problems.push(`The title must be "chore(release): ${unique[0]}", which stamps the build.`);
  }
  for (const { path, added, removed } of changes) {
    if (VERSION_FILES.has(path)) {
      if (added !== 1 || removed !== 1) problems.push(`${path} changes more than its version.`);
    } else if (!OTHER_PATHS.some((allowed) => allowed.test(path))) {
      problems.push(`${path} is not part of a release: put it in its own merge request.`);
    }
  }
  return problems;
}

function main() {
  const base = process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA;
  const numstat = execFileSync('git', ['diff', '--numstat', '--no-renames', base, 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  });
  const changes = numstat
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [added, removed, path] = line.split('\t');
      return { path, added: Number(added), removed: Number(removed) };
    });
  const problems = releaseProblems({
    changes,
    title: process.env.CI_MERGE_REQUEST_TITLE,
    versions: readVersions().map((each) => each.version),
  });
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    process.exit(1);
  }
  console.log(`Only a release: ${changes.length} file(s), no code.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
