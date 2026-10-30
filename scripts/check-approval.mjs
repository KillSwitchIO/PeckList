// Fails a merge request pipeline until one of APPROVERS has approved the merge request (GitLab
// Free has the Approve button but no required approvals). The `approval` job runs this last, so
// after approving, retry that job (or push again) and the pipeline goes green.
//   APPROVERS            usernames whose approval counts, comma or space separated
//   APPROVAL_READ_TOKEN  optional, a read_api token: with it, an approval only counts when it came
//                        after the last push (Free keeps approvals when commits are added)
// Without the token it reads the approvals anonymously, which works on a public project.

import { pathToFileURL } from 'node:url';

const APPROVED = /^approved this merge request/;
const UNAPPROVED = /^unapproved this merge request/;

/**
 * Whether the merge request may pass.
 * @param {object} input
 * @param {string[]} input.approvers usernames whose approval counts
 * @param {string[]} input.approvedBy usernames on the merge request's "Approved by" list
 * @param {{ username: string, body: string, at: string }[]} [input.notes] system notes, any order
 * @param {string} [input.pushedAt] when the commit under test was pushed to the merge request
 */
export function approvalVerdict({ approvers, approvedBy, notes, pushedAt }) {
  const who = approvers.join(', ');
  const counted = approvedBy.filter((username) => approvers.includes(username));
  if (counted.length === 0) {
    return {
      ok: false,
      message: `Not approved by ${who}. Approve the merge request, then retry this job.`,
    };
  }
  if (!notes || !pushedAt) {
    return { ok: true, message: `Approved by ${counted.join(', ')}.` };
  }
  // Each approver's latest approve or unapprove, and only one made after the push counts.
  const fresh = counted.filter((username) => {
    const last = notes
      .filter((note) => note.username === username)
      .filter((note) => APPROVED.test(note.body) || UNAPPROVED.test(note.body))
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
      .at(-1);
    return last && APPROVED.test(last.body) && Date.parse(last.at) > Date.parse(pushedAt);
  });
  if (fresh.length === 0) {
    return {
      ok: false,
      message:
        `Approved by ${counted.join(', ')} before the last push (${pushedAt}). ` +
        'Look at the new commits, unapprove and approve again, then retry this job.',
    };
  }
  return { ok: true, message: `Approved by ${fresh.join(', ')} after the last push.` };
}

async function get(path, token) {
  const base = `${process.env.CI_API_V4_URL}/projects/${process.env.CI_PROJECT_ID}`;
  const all = [];
  for (let page = 1; ; page++) {
    const separator = path.includes('?') ? '&' : '?';
    const response = await fetch(`${base}/${path}${separator}per_page=100&page=${page}`, {
      headers: token ? { 'PRIVATE-TOKEN': token } : {},
    });
    if (!response.ok) {
      throw new Error(`GET ${path} answered ${response.status}: ${await response.text()}`);
    }
    const body = await response.json();
    if (!Array.isArray(body)) return body;
    all.push(...body);
    if (!response.headers.get('x-next-page')) return all;
  }
}

async function main() {
  const iid = process.env.CI_MERGE_REQUEST_IID;
  if (!iid) {
    console.log('Not a merge request pipeline: nothing to approve.');
    return;
  }
  const approvers = (process.env.APPROVERS ?? '').split(/[\s,]+/).filter(Boolean);
  if (approvers.length === 0) {
    console.error('Set APPROVERS to the usernames whose approval counts.');
    process.exit(1);
  }
  const token = process.env.APPROVAL_READ_TOKEN || undefined;
  const mr = `merge_requests/${iid}`;
  const approvals = await get(`${mr}/approvals`, token);
  const input = {
    approvers,
    approvedBy: approvals.approved_by.map((each) => each.user.username),
  };
  if (token) {
    const notes = await get(`${mr}/notes?sort=asc`, token);
    input.notes = notes
      .filter((note) => note.system)
      .map((note) => ({ username: note.author.username, body: note.body, at: note.created_at }));
    const versions = await get(`${mr}/versions`, token);
    input.pushedAt = versions.find(
      (version) => version.head_commit_sha === process.env.CI_COMMIT_SHA,
    )?.created_at;
    if (!input.pushedAt)
      console.log('This commit is not the merge request head; not checking freshness.');
  } else {
    console.log('No APPROVAL_READ_TOKEN: an approval counts even if commits came after it.');
  }
  const verdict = approvalVerdict(input);
  (verdict.ok ? console.log : console.error)(verdict.message);
  if (!verdict.ok) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
