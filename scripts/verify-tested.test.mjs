import assert from 'node:assert/strict';
import { test } from 'node:test';
import { testedVerdict } from './verify-tested.mjs';

const sha = 'mergecommit000';
const passed = {
  iid: 7,
  sha: 'branchhead0000',
  merge_commit_sha: sha,
  head_pipeline: { status: 'success', sha: 'branchhead0000' },
};
const same = { diffs: [] };

test('passes when the merged tree is what a green pipeline tested', () => {
  const verdict = testedVerdict({ sha, mergeRequests: [passed], comparison: same });
  assert.equal(verdict.ok, true);
  assert.match(verdict.message, /!7 tested exactly this tree/);
});

test('fails a branch that was behind main, whose merged tree nothing tested', () => {
  const comparison = { diffs: [{ new_path: 'web/src/a.ts' }, { new_path: 'web/src/b.ts' }] };
  const verdict = testedVerdict({ sha, mergeRequests: [passed], comparison });
  assert.equal(verdict.ok, false);
  assert.match(verdict.message, /2 file\(s\) differ.*behind main/);
});

test('fails a commit that came through no merge request', () => {
  const verdict = testedVerdict({ sha, mergeRequests: [], comparison: null });
  assert.equal(verdict.ok, false);
  assert.match(verdict.message, /FULL_CHECK=true/);
});

test('ignores a merge request that only contains the commit', () => {
  const other = { ...passed, iid: 8, merge_commit_sha: 'another' };
  assert.equal(testedVerdict({ sha, mergeRequests: [other], comparison: null }).ok, false);
});

test('fails when the head pipeline did not pass', () => {
  const failed = { ...passed, head_pipeline: { status: 'failed', sha: passed.sha } };
  const verdict = testedVerdict({ sha, mergeRequests: [failed], comparison: same });
  assert.equal(verdict.ok, false);
  assert.match(verdict.message, /is failed, not success/);
});

test('fails when the last pipeline ran on an older head', () => {
  const stale = { ...passed, head_pipeline: { status: 'success', sha: 'oldhead' } };
  const verdict = testedVerdict({ sha, mergeRequests: [stale], comparison: same });
  assert.equal(verdict.ok, false);
  assert.match(verdict.message, /is missing, not success/);
});

test('fails when the comparison was cut short', () => {
  const comparison = { diffs: [], compare_timeout: true };
  assert.equal(testedVerdict({ sha, mergeRequests: [passed], comparison }).ok, false);
});

test('accepts the squash commit as the merged commit', () => {
  const squashed = { ...passed, merge_commit_sha: undefined, squash_commit_sha: sha };
  assert.equal(testedVerdict({ sha, mergeRequests: [squashed], comparison: same }).ok, true);
});
