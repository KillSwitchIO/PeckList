// The prepare-release button (docs/development/releasing.md): make the release commit from this
// pipeline's commit and open its merge request. The number follows the rule in pnpm release unless
// RELEASE_VERSION names one, such as a pre-release. Needs GITLAB_API_TOKEN (api, write_repository).

import { execFileSync } from 'node:child_process';
import { readVersions, root } from '../versions.mjs';

const { CI_API_V4_URL, CI_PROJECT_ID, CI_PROJECT_PATH, CI_SERVER_HOST, GITLAB_API_TOKEN } =
  process.env;
const asked = process.env.RELEASE_VERSION?.trim();

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });

git('fetch', '--tags', '--quiet');
execFileSync(
  'node',
  ['scripts/release.mjs', ...(asked ? [asked] : []), '--any-branch', '--no-tag'],
  { cwd: root, stdio: 'inherit' },
);

const [{ version }] = readVersions();
const branch = `release/${version}`;
git(
  'push',
  `https://oauth2:${GITLAB_API_TOKEN}@${CI_SERVER_HOST}/${CI_PROJECT_PATH}.git`,
  `HEAD:refs/heads/${branch}`,
);

const response = await fetch(`${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/merge_requests`, {
  method: 'POST',
  headers: { 'PRIVATE-TOKEN': GITLAB_API_TOKEN, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    source_branch: branch,
    target_branch: 'main',
    title: `chore(release): ${version}`,
    description: `The release commit for ${version}: its version, changelog and docs copy, and no code (\`release-guard\` checks that). Merging it builds the image stamped ${version} and puts it on the test server. Publishing is a separate button on that main pipeline, \`cut-release\`.`,
    squash: true,
    remove_source_branch: true,
  }),
});
if (!response.ok)
  throw new Error(`Opening the merge request: ${response.status} ${await response.text()}`);
const opened = await response.json();
console.log(`Opened !${opened.iid} for ${version}: ${opened.web_url}`);
