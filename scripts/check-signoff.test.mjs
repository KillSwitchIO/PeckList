import assert from 'node:assert/strict';
import test from 'node:test';
import { isFork, unsignedCommits } from './check-signoff.mjs';

const commit = (email, message) => ({ sha: '0123456789abcdef', author: 'Sam', email, message });

test("a commit passes with a sign-off by its own author, whatever the email's case", () => {
  const signed = commit(
    'sam@example.com',
    'fix: a thing\n\nSigned-off-by: Sam Smith <Sam@Example.com>\n',
  );
  assert.deepEqual(unsignedCommits([signed]), []);
});

test('a sign-off line ending in a carriage return still counts', () => {
  const crlf = commit(
    'sam@example.com',
    'fix: a thing\r\n\r\nSigned-off-by: Sam <sam@example.com>\r\n',
  );
  assert.deepEqual(unsignedCommits([crlf]), []);
});

test('a commit with no sign-off, or one by someone else, fails', () => {
  const none = commit('sam@example.com', 'fix: a thing\n');
  const other = commit('sam@example.com', 'fix: a thing\n\nSigned-off-by: Kim <kim@example.com>\n');
  const inBody = commit(
    'sam@example.com',
    'fix: says Signed-off-by: Sam <sam@example.com> mid-line\n',
  );
  assert.deepEqual(unsignedCommits([none, other, inBody]), [none, other, inBody]);
});

test('a co-signed commit passes when its author is among the signers', () => {
  const both = commit(
    'sam@example.com',
    'feat: x\n\nSigned-off-by: Kim <kim@example.com>\nSigned-off-by: Sam <sam@example.com>\n',
  );
  assert.deepEqual(unsignedCommits([both]), []);
});

test('only a merge request from another project is a fork', () => {
  assert.equal(
    isFork({ CI_MERGE_REQUEST_SOURCE_PROJECT_ID: '9', CI_MERGE_REQUEST_PROJECT_ID: '87938160' }),
    true,
  );
  assert.equal(
    isFork({
      CI_MERGE_REQUEST_SOURCE_PROJECT_ID: '87938160',
      CI_MERGE_REQUEST_PROJECT_ID: '87938160',
    }),
    false,
  );
  assert.equal(isFork({}), false);
});
