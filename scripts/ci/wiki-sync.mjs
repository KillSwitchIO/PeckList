// Mirror docs/ into the project's GitLab wiki (docs/development/ci.md). Runs on main after a merge:
//   node scripts/ci/wiki-sync.mjs            clone the wiki, replace its pages, commit and push
//   node scripts/ci/wiki-sync.mjs --out DIR  only write the pages into DIR (to look at them)
// Needs GITLAB_API_TOKEN (a token with write_repository) and the CI_* variables for the push.

import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { wikiPages } from '../wiki-pages.mjs';
import { root } from '../versions.mjs';

const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

const docs = new Map();
for (const path of walk(join(root, 'docs'))) {
  if (path.endsWith('.md'))
    docs.set(relative(root, path).replaceAll('\\', '/'), readFileSync(path, 'utf8'));
}
const pages = wikiPages({
  docs,
  mkdocs: readFileSync(join(root, 'mkdocs.yml'), 'utf8'),
  read: (path) => readFileSync(join(root, path), 'utf8'),
});

const git = (dir, ...gitArgs) =>
  execFileSync('git', gitArgs, {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });

let dir;
if (outFlag >= 0) {
  dir = args[outFlag + 1] ?? 'wiki-out';
  mkdirSync(dir, { recursive: true });
} else {
  const { GITLAB_API_TOKEN, CI_SERVER_HOST, CI_PROJECT_PATH } = process.env;
  if (!GITLAB_API_TOKEN || !CI_SERVER_HOST || !CI_PROJECT_PATH) {
    console.error('wiki-sync needs GITLAB_API_TOKEN, CI_SERVER_HOST and CI_PROJECT_PATH.');
    process.exit(2);
  }
  dir = mkdtempSync(join(tmpdir(), 'wiki-'));
  const url = `https://oauth2:${GITLAB_API_TOKEN}@${CI_SERVER_HOST}/${CI_PROJECT_PATH}.wiki.git`;
  execFileSync('git', ['clone', '--quiet', url, dir], { stdio: ['ignore', 'inherit', 'inherit'] });
  // Everything but the git folder goes: pages that left the docs leave the wiki.
  for (const name of readdirSync(dir))
    if (name !== '.git') rmSync(join(dir, name), { recursive: true });
  git(dir, 'config', 'user.name', 'PeckList CI');
  git(dir, 'config', 'user.email', 'ci@pecklist.invalid');
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
}

for (const [path, text] of pages) {
  const file = join(dir, `${path}.md`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}
console.log(`${pages.size} pages written to ${dir}`);
if (outFlag >= 0) process.exit(0);

git(dir, 'add', '--all');
if (!git(dir, 'status', '--porcelain').trim()) {
  console.log('The wiki already matches the docs.');
  process.exit(0);
}
git(
  dir,
  'commit',
  '--quiet',
  '-m',
  `docs: mirror of docs/ at ${process.env.CI_COMMIT_SHORT_SHA ?? 'main'}`,
);
// A new wiki has no branch yet; GitLab names the first one after the project's default branch.
const branch = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
const target = branch === 'HEAD' ? 'main' : branch;
execFileSync('git', ['push', '--quiet', 'origin', `HEAD:${target}`], {
  cwd: dir,
  stdio: ['ignore', 'inherit', 'inherit'],
});
console.log(`Pushed to the wiki (${target}).`);
