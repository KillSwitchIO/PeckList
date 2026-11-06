// Approves Renovate's routine merge requests as the bot, so patches and minors do not wait for a
// person at the `approval` job. It runs on main, where the bot's protected token exists, and never
// in a merge request pipeline, where a branch could read it.
//
// Only a merge request that passes all of these: from a renovate/ branch, not a major, not a draft,
// and changing nothing but dependency files. Gradle stays out on purpose: it tracks Capacitor's
// template and goes by hand (renovate.json).
//   GITLAB_API_TOKEN   the bot's token, protected and masked

import { pathToFileURL } from 'node:url';
import { isRoutineRenovate } from '../check-approval.mjs';

const DEPENDENCY_FILE =
  /(^|\/)(package\.json|pnpm-lock\.yaml|Directory\.Packages\.props|requirements[^/]*\.txt)$/;

/**
 * Whether the bot may approve this merge request.
 * @param {object} input
 * @param {string} input.sourceBranch
 * @param {string[]} input.labels
 * @param {boolean} input.draft
 * @param {string[]} input.paths every file it changes
 */
export function botMayApprove({ sourceBranch, labels, draft, paths }) {
  return (
    isRoutineRenovate({ sourceBranch, labels }) &&
    !draft &&
    paths.length > 0 &&
    paths.every((path) => DEPENDENCY_FILE.test(path))
  );
}

/**
 * One pass: approve what qualifies, then retry one failed pipeline among them, so the `approval`
 * job can pass. One, because the runner takes one thing at a time; the next main pipeline takes
 * the next.
 * @param {{ get: (path: string) => Promise<any>, post: (path: string) => Promise<any>, log: (line: string) => void }} api
 */
export async function approveRenovate({ get, post, log }) {
  const me = (await get('/user')).username;
  const open = await get('merge_requests?state=opened&labels=renovate&per_page=100');
  let retried = false;
  for (const { iid } of open) {
    const mr = await get(`merge_requests/${iid}/changes`);
    const paths = mr.changes.map((change) => change.new_path);
    const input = {
      sourceBranch: mr.source_branch,
      labels: mr.labels,
      draft: mr.draft,
      paths,
    };
    if (!botMayApprove(input)) {
      log(`!${iid} left for a person: ${mr.title}`);
      continue;
    }
    const approvals = await get(`merge_requests/${iid}/approvals`);
    if (approvals.approved_by.some((each) => each.user.username === me)) {
      log(`!${iid} already approved by ${me}`);
    } else {
      await post(`merge_requests/${iid}/approve`);
      log(`!${iid} approved by ${me}: ${mr.title}`);
    }
    const pipeline = mr.head_pipeline;
    if (!retried && pipeline?.status === 'failed') {
      await post(`pipelines/${pipeline.id}/retry`);
      log(`!${iid} pipeline ${pipeline.id} retried`);
      retried = true;
    }
  }
}

async function call(method, path) {
  const project = `${process.env.CI_API_V4_URL}/projects/${process.env.CI_PROJECT_ID}`;
  const url = path.startsWith('/') ? `${process.env.CI_API_V4_URL}${path}` : `${project}/${path}`;
  const response = await fetch(url, {
    method,
    headers: { 'PRIVATE-TOKEN': process.env.GITLAB_API_TOKEN },
  });
  if (!response.ok) {
    throw new Error(`${method} ${path} answered ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  approveRenovate({
    get: (path) => call('GET', path),
    post: (path) => call('POST', path),
    log: console.log,
  }).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
