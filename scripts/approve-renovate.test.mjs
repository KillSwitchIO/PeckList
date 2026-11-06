import assert from 'node:assert/strict';
import test from 'node:test';
import { approveRenovate, botMayApprove } from './ci/approve-renovate.mjs';

const routine = {
  sourceBranch: 'renovate/all-non-major-dependencies',
  labels: ['renovate'],
  draft: false,
  paths: ['web/package.json', 'pnpm-lock.yaml', 'server/Directory.Packages.props'],
};

test('the bot approves a routine Renovate merge request', () => {
  assert.equal(botMayApprove(routine), true);
});

test('the bot leaves everything else for a person', () => {
  const cases = {
    'a branch of someone else': { sourceBranch: 'fix/something' },
    'a major': { labels: ['renovate', 'major'] },
    'a draft': { draft: true },
    'Gradle, which goes by hand': { paths: ['mobile/android/variables.gradle'] },
    'the Gradle wrapper': { paths: ['mobile/android/gradle/wrapper/gradle-wrapper.properties'] },
    'code among the dependencies': { paths: ['web/package.json', 'web/src/main.tsx'] },
    'CI among the dependencies': { paths: ['pnpm-lock.yaml', '.gitlab-ci.yml'] },
    'a file that only ends the same': { paths: ['evil-package.json'] },
    'nothing at all': { paths: [] },
  };
  for (const [name, change] of Object.entries(cases)) {
    assert.equal(botMayApprove({ ...routine, ...change }), false, name);
  }
});

/** A fake of the API: merge requests by id, recording what gets posted. */
function fakeApi(mergeRequests) {
  const posted = [];
  const lines = [];
  return {
    posted,
    lines,
    log: (line) => lines.push(line),
    post: async (path) => {
      posted.push(path);
      return {};
    },
    get: async (path) => {
      if (path === '/user') return { username: 'the-bot' };
      if (path.startsWith('merge_requests?')) return mergeRequests.map(({ iid }) => ({ iid }));
      const [, iid, what] = /^merge_requests\/(\d+)\/(\w+)$/.exec(path);
      const mr = mergeRequests.find((each) => each.iid === Number(iid));
      if (what === 'approvals') {
        return { approved_by: (mr.approvedBy ?? []).map((username) => ({ user: { username } })) };
      }
      return {
        title: `MR ${iid}`,
        source_branch: mr.branch ?? 'renovate/x',
        labels: mr.labels ?? ['renovate'],
        draft: false,
        changes: (mr.paths ?? ['pnpm-lock.yaml']).map((new_path) => ({ new_path })),
        head_pipeline: mr.pipeline ?? null,
      };
    },
  };
}

test('a pass approves what qualifies and nothing else', async () => {
  const api = fakeApi([
    { iid: 1 },
    { iid: 2, paths: ['mobile/android/variables.gradle'] },
    { iid: 3, labels: ['renovate', 'major'] },
  ]);
  await approveRenovate(api);
  assert.deepEqual(api.posted, ['merge_requests/1/approve']);
  assert.match(api.lines.join('\n'), /!2 left for a person/);
});

test('a second pass does not approve again, which GitLab would refuse', async () => {
  const api = fakeApi([{ iid: 1, approvedBy: ['the-bot'] }]);
  await approveRenovate(api);
  assert.deepEqual(api.posted, []);
});

test('it retries a failed pipeline so the approval job can pass, one per pass', async () => {
  const api = fakeApi([
    { iid: 1, pipeline: { id: 10, status: 'failed' } },
    { iid: 2, pipeline: { id: 20, status: 'failed' } },
    { iid: 3, pipeline: { id: 30, status: 'running' } },
  ]);
  await approveRenovate(api);
  assert.deepEqual(api.posted, [
    'merge_requests/1/approve',
    'pipelines/10/retry',
    'merge_requests/2/approve',
    'merge_requests/3/approve',
  ]);
});

test('it never retries a pipeline it did not approve', async () => {
  const api = fakeApi([
    { iid: 1, paths: ['mobile/android/variables.gradle'], pipeline: { id: 10, status: 'failed' } },
  ]);
  await approveRenovate(api);
  assert.deepEqual(api.posted, []);
});
