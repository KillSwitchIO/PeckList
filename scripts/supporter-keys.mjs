// The public keys a release checks supporter keys against (PL-112) are a constant,
// SupporterKeyCheck.BuiltIn. The signing key is made by Ben or in CI on the issuing service's host and
// never shown, so the repository cannot tell a real public half from one pasted in from a test. This
// check can: SUPPORTER_PUBLIC_KEYS, a CI variable holding the real public halves (public values, so
// neither protected nor masked), set when the signing key is made. A release fails when BuiltIn
// lists a key that variable does not. While BuiltIn is empty no key checks out, so there is nothing
// to guard and it passes.
//   node scripts/supporter-keys.mjs   (in prepare-release and release-guard)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from './versions.mjs';

export const SOURCE = 'server/src/PeckList.Server/Supporters/SupporterKeyCheck.cs';

/** The base64 strings in `BuiltIn = [ ... ];`; null when the declaration is not found. */
export function builtInKeys(source) {
  const match = /\bBuiltIn\s*=\s*\[([^\]]*)\]/.exec(source);
  if (!match) return null;
  return [...match[1].matchAll(/"([^"]*)"/g)].map((each) => each[1].trim());
}

/** An Ed25519 public half as BuiltIn holds it: base64 of exactly 32 bytes. */
export function isPublicHalf(text) {
  return /^[A-Za-z0-9+/]{43}=$/.test(text) && Buffer.from(text, 'base64').length === 32;
}

/**
 * What is wrong with the built-in keys; empty when nothing is.
 * @param {string[] | null} builtIn
 * @param {string | undefined} expected SUPPORTER_PUBLIC_KEYS: the real public halves, comma or space separated
 */
export function supporterKeyProblems(builtIn, expected) {
  if (builtIn === null)
    return [`${SOURCE}: the BuiltIn declaration was not found, so it cannot be checked.`];
  if (builtIn.length === 0) return [];
  const known = new Set((expected ?? '').split(/[\s,]+/).filter(Boolean));
  const problems = [];
  if (known.size === 0) {
    problems.push(
      'SupporterKeyCheck.BuiltIn lists keys, but SUPPORTER_PUBLIC_KEYS is not set: set it to the real ' +
        "public halves (the output of the service's public-key command) so a test key cannot ship.",
    );
  }
  for (const key of builtIn) {
    if (!isPublicHalf(key))
      problems.push(`BuiltIn holds "${key}", which is not a base64 Ed25519 public key.`);
    else if (known.size > 0 && !known.has(key)) {
      problems.push(
        `BuiltIn holds ${key}, which is not in SUPPORTER_PUBLIC_KEYS: a test key? Only real keys ship.`,
      );
    }
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const builtIn = builtInKeys(readFileSync(join(root, SOURCE), 'utf8'));
  const problems = supporterKeyProblems(builtIn, process.env.SUPPORTER_PUBLIC_KEYS);
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    process.exit(1);
  }
  console.log(
    builtIn.length === 0
      ? 'No supporter public keys built in yet: no supporter key checks out.'
      : `Supporter public keys: ${builtIn.length}, all in SUPPORTER_PUBLIC_KEYS.`,
  );
}
