import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalVerdict } from './check-approval.mjs';

const approvers = ['hambone0'];
const note = (username, body, at) => ({ username, body, at });

test('a merge request passes only once an approver has approved it', () => {
  assert.equal(approvalVerdict({ approvers, approvedBy: [] }).ok, false);
  assert.equal(approvalVerdict({ approvers, approvedBy: ['someone-else'] }).ok, false);
  const passed = approvalVerdict({ approvers, approvedBy: ['someone-else', 'hambone0'] });
  assert.equal(passed.ok, true);
  assert.match(passed.message, /hambone0/);
});

test('with the push time known, an approval made before the last push does not count', () => {
  const pushedAt = '2026-10-30T15:00:00Z';
  const before = [note('hambone0', 'approved this merge request', '2026-10-30T14:00:00Z')];
  const stale = approvalVerdict({ approvers, approvedBy: ['hambone0'], notes: before, pushedAt });
  assert.equal(stale.ok, false);
  assert.match(stale.message, /before the last push/);

  const after = [
    ...before,
    note('hambone0', 'unapproved this merge request', '2026-10-30T15:05:00Z'),
    note('hambone0', 'approved this merge request', '2026-10-30T15:06:00Z'),
  ];
  assert.equal(
    approvalVerdict({ approvers, approvedBy: ['hambone0'], notes: after, pushedAt }).ok,
    true,
  );
});

test("someone else's fresh approval or other system notes do not stand in for an approver's", () => {
  const pushedAt = '2026-10-30T15:00:00Z';
  const notes = [
    note('hambone0', 'approved this merge request', '2026-10-30T14:00:00Z'),
    note('someone-else', 'approved this merge request', '2026-10-30T15:10:00Z'),
    note('hambone0', 'added 1 commit', '2026-10-30T15:20:00Z'),
  ];
  const verdict = approvalVerdict({
    approvers,
    approvedBy: ['hambone0', 'someone-else'],
    notes,
    pushedAt,
  });
  assert.equal(verdict.ok, false);
});
