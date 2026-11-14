import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { builtInKeys, isPublicHalf, SOURCE, supporterKeyProblems } from './supporter-keys.mjs';
import { root } from './versions.mjs';

/** A fresh Ed25519 public half, raw and base64, as `pecklist-keys public-key` prints it. */
const publicHalf = () =>
  generateKeyPairSync('ed25519')
    .publicKey.export({ format: 'der', type: 'spki' })
    .subarray(-32)
    .toString('base64');

test('the built-in keys are read from the C# declaration', () => {
  assert.deepEqual(builtInKeys('public static readonly string[] BuiltIn = [];'), []);
  assert.deepEqual(builtInKeys('BuiltIn =\n    [\n        "a",\n        "b",\n    ];'), ['a', 'b']);
  assert.equal(builtInKeys('nothing here'), null);
  // The real file parses (whatever it holds today).
  assert.ok(Array.isArray(builtInKeys(readFileSync(join(root, SOURCE), 'utf8'))));
});

test('nothing built in passes: no key checks out, so nothing can ship by mistake', () => {
  assert.deepEqual(supporterKeyProblems([], undefined), []);
});

test('a built-in key must be one of the real public halves', () => {
  const real = publicHalf();
  const test = publicHalf();
  assert.equal(isPublicHalf(real), true);
  assert.deepEqual(supporterKeyProblems([real], `${publicHalf()}, ${real}`), []);

  const pasted = supporterKeyProblems([real, test], real);
  assert.equal(pasted.length, 1);
  assert.match(pasted[0], /not in SUPPORTER_PUBLIC_KEYS/);

  assert.match(supporterKeyProblems([real], undefined)[0], /SUPPORTER_PUBLIC_KEYS is not set/);
  assert.match(supporterKeyProblems(['not-a-key'], real)[0], /not a base64 Ed25519 public key/);
  assert.match(supporterKeyProblems(null, real)[0], /not found/);
});
