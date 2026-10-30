// Where the app version lives. One version, written in three places because each build reads its
// own: the web package, the web app's constant (stamped into workspace files), and the server's
// MSBuild properties. `node scripts/check-version.mjs` keeps them equal; `pnpm release` bumps all
// three together.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const places = [
  {
    file: 'web/package.json',
    pattern: /("version":\s*")([^"]+)(")/,
  },
  {
    file: 'web/src/core/workspace.ts',
    pattern: /(export const APP_VERSION = ')([^']+)(')/,
  },
  {
    file: 'server/Directory.Build.props',
    pattern: /(<Version>)([^<]+)(<\/Version>)/,
  },
];

/** Semantic version core with an optional pre-release: 1.2.3 or 1.2.3-rc.1. */
export const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/** A Conventional Commit that adds something: `feat: ...`, `feat(scope): ...`, `feat!: ...`. */
const FEATURE = /^feat(\([^)]*\))?!?:/;
/** A breaking change: `type!:` in the subject, or a `BREAKING CHANGE:` footer. */
const BREAKING = /^[a-z]+(\([^)]*\))?!:|^BREAKING[ -]CHANGE:/m;

/**
 * What a release is, from the commit messages since the last tag (Ben, 2026-10-30): any feature
 * makes it a minor release (0.x.0); only fixes, dependency and version bumps and chores make it a
 * patch (0.0.x). From 1.0 on a breaking change makes it a major; before 1.0 it counts as a feature.
 */
export function releaseKind(current, messages) {
  const [major] = current.split(/[.-]/).map(Number);
  if (major >= 1 && messages.some((message) => BREAKING.test(message))) return 'major';
  if (messages.some((message) => FEATURE.test(message) || BREAKING.test(message))) return 'minor';
  return 'patch';
}

/** The release after `current` for those commits. A pre-release (0.3.0-rc.1) releases as its core. */
export function nextVersion(current, messages) {
  const match = SEMVER.exec(current);
  if (!match) throw new Error(`not a version: ${current}`);
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (match[4]) return `${major}.${minor}.${patch}`;
  const kind = releaseKind(current, messages);
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** Each place with the version it holds. */
export function readVersions() {
  return places.map(({ file, pattern }) => {
    const text = readFileSync(join(root, file), 'utf8');
    const match = pattern.exec(text);
    if (!match) throw new Error(`no version found in ${file}`);
    return { file, version: match[2] };
  });
}

/** Write one version into every place. */
export function writeVersion(version) {
  for (const { file, pattern } of places) {
    const path = join(root, file);
    const text = readFileSync(path, 'utf8');
    writeFileSync(path, text.replace(pattern, `$1${version}$3`));
  }
}

/** `v0.2.0+20261023` -> { version: '0.2.0', build: '20261023', prerelease: false }. */
export function parseTag(tag) {
  const [core, build = ''] = tag.replace(/^v/, '').split('+');
  if (!SEMVER.test(core)) throw new Error(`not a release tag: ${tag}`);
  return { version: core, build, prerelease: core.includes('-') };
}
