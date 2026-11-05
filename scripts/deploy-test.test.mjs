import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import { pinImage, releaseState, targetOf } from './ci/deploy-test.mjs';

const image = 'registry.gitlab.com/killswitch10/pecklist';
const compose = `services:\n  pecklist-test:\n    image: ${image}:sha-c758eb16\n    restart: unless-stopped\n`;

test('a build pins its commit and digest; a release pins its version', () => {
  assert.equal(targetOf({ shortSha: 'abc12345' }), 'sha-abc12345');
  assert.equal(targetOf({ shortSha: 'abc12345', digest: 'sha256:d1' }), 'sha-abc12345@sha256:d1');
  assert.equal(targetOf({ tag: 'v0.8.0+20261105', shortSha: 'abc12345' }), '0.8.0');
});

test('pinning replaces only the image line and says what it was', () => {
  const pinned = pinImage(compose, image, 'sha-new@sha256:d1');
  assert.equal(pinned.was, 'sha-c758eb16');
  assert.match(
    pinned.updated,
    /image: registry\.gitlab\.com\/killswitch10\/pecklist:sha-new@sha256:d1\n/,
  );
  assert.match(pinned.updated, /restart: unless-stopped/);
});

test('a pin with a digest can be pinned again', () => {
  const once = pinImage(compose, image, 'sha-new@sha256:d1').updated;
  assert.equal(pinImage(once, image, 'sha-next').was, 'sha-new@sha256:d1');
});

test('a compose file without this image cannot be pinned', () => {
  assert.equal(pinImage('services:\n  a:\n    image: nginx:1\n', image, 'x'), null);
});

test('the release job, not the parent pipeline, decides the result', () => {
  const job = (status) => [{ name: 'release:pecklist-test', status, web_url: 'https://job' }];
  assert.deepEqual(releaseState('success', job('success'), 'pecklist-test'), {
    done: true,
    ok: true,
  });
  const failed = releaseState('success', job('failed'), 'pecklist-test');
  assert.equal(failed.ok, false);
  assert.match(failed.why, /release:pecklist-test failed/);
  assert.deepEqual(releaseState('running', job('running'), 'pecklist-test'), { done: false });
});

test('compose refusing before it gets to releasing is a failure, not a wait', () => {
  assert.equal(releaseState('failed', null, 'pecklist-test').ok, false);
  assert.deepEqual(releaseState('running', null, 'pecklist-test'), { done: false });
});

test('production is refused before anything is touched', () => {
  const result = spawnSync(process.execPath, [join(import.meta.dirname, 'ci', 'deploy-test.mjs')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GITLAB_API_TOKEN: 'unused',
      CI_COMMIT_SHORT_SHA: 'abc12345',
      COMPOSE_SERVICE: 'pecklist',
      CI_API_V4_URL: 'http://127.0.0.1:9',
    },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /only moves through a release/);
});
