// Fails a merge request from a fork when one of its commits has no sign-off (CONTRIBUTING.md:
// every outside contribution is signed off, `git commit -s`, in the sense of the Developer
// Certificate of Origin). Commits by Ben and the agents are exempt (Ben, 2026-11-21: "Outside
// contributors only"): they come from branches of this project, so only a fork's merge request is
// checked. The `signoff` job runs it, with the merge request's history fetched in full.
//   node scripts/check-signoff.mjs   in a merge request pipeline (GitLab's CI_MERGE_REQUEST_* variables)

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// A trailer on its own line; a trailing \r (a commit made verbatim or on the web) is allowed.
const TRAILER = /^Signed-off-by:[ \t]*(.+?)[ \t]*<([^<>\s]+@[^<>\s]+)>[ \t\r]*$/gim;

/**
 * The commits without a sign-off by their author: a `Signed-off-by: Name <email>` line whose email
 * is the commit author's (letter case aside), as the DCO asks.
 * @param {{ sha: string, author: string, email: string, message: string }[]} commits
 * @returns {{ sha: string, author: string, email: string, message: string }[]}
 */
export function unsignedCommits(commits) {
  return commits.filter(({ email, message }) => {
    const signers = [...message.matchAll(TRAILER)].map((match) => match[2].toLowerCase());
    return !signers.includes(email.toLowerCase());
  });
}

/** Whether a merge request pipeline is for a fork's merge request. */
export function isFork(env) {
  const source = env.CI_MERGE_REQUEST_SOURCE_PROJECT_ID;
  const target = env.CI_MERGE_REQUEST_PROJECT_ID;
  return Boolean(source && target && source !== target);
}

/**
 * The merge request's own commits, from its diff base to the commit under test (merges aside).
 * In a merged-results pipeline (GitLab Premium, not used here) HEAD would be a merge with main, and
 * this range would take in main's own commits too.
 */
function commitsSince(base) {
  const log = execFileSync(
    'git',
    ['log', '--no-merges', '--format=%H%x00%an%x00%ae%x00%B%x01', `${base}..HEAD`],
    {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  return log
    .split('\x01')
    .map((entry) => entry.replace(/^\n/, ''))
    .filter(Boolean)
    .map((entry) => {
      const [sha, author, email, message] = entry.split('\x00');
      return { sha, author, email, message };
    });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env;
  if (!env.CI_MERGE_REQUEST_IID) {
    console.log('Not a merge request pipeline: nothing to check.');
  } else if (!isFork(env)) {
    console.log('A merge request from a branch of this project: its commits need no sign-off.');
  } else {
    const base = env.CI_MERGE_REQUEST_DIFF_BASE_SHA;
    if (!base) {
      console.error(
        'No CI_MERGE_REQUEST_DIFF_BASE_SHA: cannot tell which commits are the merge request’s.',
      );
      process.exit(1);
    }
    const commits = commitsSince(base);
    const unsigned = unsignedCommits(commits);
    if (unsigned.length > 0) {
      console.error(
        [
          `${unsigned.length} of ${commits.length} commits have no sign-off by their author:`,
          ...unsigned.map(
            ({ sha, author, email, message }) =>
              `  ${sha.slice(0, 8)} ${author} <${email}>: ${message.split('\n')[0]}`,
          ),
          '',
          'Sign off each commit (CONTRIBUTING.md, "License and contributions"): for the last one,',
          '`git commit --amend -s`; for all of them, `git rebase --signoff ' +
            base.slice(0, 8) +
            '`.',
          'Then push again (a force push to your fork is fine).',
        ].join('\n'),
      );
      process.exit(1);
    }
    console.log(
      commits.length === 1
        ? 'The commit is signed off by its author.'
        : `All ${commits.length} commits are signed off by their authors.`,
    );
  }
}
