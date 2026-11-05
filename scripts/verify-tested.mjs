// Whether the tree on main is the tree a merge request's pipeline passed. Main runs no test suites
// of its own once this holds (docs/development/ci.md), so this job is what stands behind that: it
// fails a commit that did not arrive through a merge request, whose pipeline did not pass, or whose
// merged tree differs from what that pipeline tested.
//   GITLAB_API_TOKEN  a token that can read the project (the API hides merge request pipelines from
//                     anonymous readers, and a job token cannot list them)

import { pathToFileURL } from 'node:url';

/**
 * Whether main may trust the merge request's run.
 * @param {object} input
 * @param {string} input.sha the commit on main
 * @param {{ iid: number, sha: string, merge_commit_sha?: string, squash_commit_sha?: string,
 *   head_pipeline?: { status: string, sha: string } | null }[]} input.mergeRequests details of the
 *   merge requests that hold this commit
 * @param {{ diffs: unknown[], compare_timeout?: boolean } | null} input.comparison the merge
 *   request's head compared with the commit (null when there is no merge request to compare)
 */
export function testedVerdict({ sha, mergeRequests, comparison }) {
  const merged = mergeRequests.find(
    (each) => each.merge_commit_sha === sha || each.squash_commit_sha === sha,
  );
  if (!merged) {
    return {
      ok: false,
      message: `${sha.slice(0, 8)} did not arrive through a merge request, so nothing tested it. Run a pipeline on main with FULL_CHECK=true.`,
    };
  }
  const pipeline = merged.head_pipeline;
  if (pipeline?.sha !== merged.sha || pipeline.status !== 'success') {
    return {
      ok: false,
      message: `!${merged.iid}: the pipeline of its head ${merged.sha.slice(0, 8)} is ${pipeline?.sha === merged.sha ? pipeline.status : 'missing'}, not success.`,
    };
  }
  if (!comparison || comparison.compare_timeout || comparison.diffs.length > 0) {
    const files = comparison ? `${comparison.diffs.length} file(s) differ` : 'no comparison';
    return {
      ok: false,
      message: `!${merged.iid}: this tree is not what its pipeline tested (${files}): the branch was behind main.`,
    };
  }
  return { ok: true, message: `!${merged.iid} tested exactly this tree, and passed.` };
}

async function main() {
  const { CI_API_V4_URL, CI_PROJECT_ID, CI_COMMIT_SHA: sha, GITLAB_API_TOKEN } = process.env;
  const get = async (path) => {
    const response = await fetch(`${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/${path}`, {
      headers: { 'PRIVATE-TOKEN': GITLAB_API_TOKEN ?? '' },
    });
    if (!response.ok) throw new Error(`GET ${path}: ${response.status} ${await response.text()}`);
    return response.json();
  };
  const found = await get(`repository/commits/${sha}/merge_requests`);
  // The list leaves out head_pipeline, so each one is read on its own.
  const mergeRequests = await Promise.all(found.map(({ iid }) => get(`merge_requests/${iid}`)));
  const merged = mergeRequests.find(
    (each) => each.merge_commit_sha === sha || each.squash_commit_sha === sha,
  );
  const comparison = merged
    ? await get(`repository/compare?from=${merged.sha}&to=${sha}&straight=true`)
    : null;
  const verdict = testedVerdict({ sha, mergeRequests, comparison });
  (verdict.ok ? console.log : console.error)(verdict.message);
  if (!verdict.ok) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
