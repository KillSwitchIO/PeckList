// Where the app version lives. One version, written in four places because each build reads its
// own: the web package, the web app's constant (stamped into workspace files), the server's MSBuild
// properties and the Android app's version.properties (with its version code, which follows from
// the version). `node scripts/check-version.mjs` keeps them equal; `pnpm release` bumps all of them
// together.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The Android app's version file: F-Droid builds a release tag from it with nothing set. */
export const ANDROID_VERSION_FILE = 'mobile/android/app/version.properties';
const ANDROID_CODE = /^(versionCode=)(.*?)()$/m;

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
  {
    file: ANDROID_VERSION_FILE,
    pattern: /^(versionName=)(.+?)()$/m,
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

/**
 * The version the next release takes. A version prepared but never released (its build failed on the
 * test server, so nobody cut it) is prepared again rather than skipped over; a pre-release moves on
 * to its release.
 */
export function plannedVersion(current, messages, currentReleased) {
  if (!currentReleased && !current.includes('-')) return current;
  return nextVersion(current, messages);
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

/**
 * The Android version code for a version, the same rule as mobile/android/app/build.gradle: it
 * grows with every release, and an rc sorts before its release. MAJOR * 10,000,000 + MINOR *
 * 100,000 + PATCH * 1,000, plus N for -rc.N, 999 for the release itself, 0 for any other
 * pre-release (a build between releases).
 */
export function androidVersionCode(version) {
  const match = SEMVER.exec(version);
  if (!match) throw new Error(`not a version: ${version}`);
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const rc = match[4] === undefined ? 999 : Number(/^rc\.(\d+)/.exec(match[4])?.[1] ?? 0);
  if (minor > 99 || patch > 99 || rc > 999 || major > 213) {
    throw new Error(`no Android version code for ${version}`);
  }
  return major * 10_000_000 + minor * 100_000 + patch * 1_000 + rc;
}

/** The version code version.properties holds. */
export function readAndroidVersionCode() {
  const text = readFileSync(join(root, ANDROID_VERSION_FILE), 'utf8');
  const match = ANDROID_CODE.exec(text);
  if (!match) throw new Error(`no versionCode in ${ANDROID_VERSION_FILE}`);
  return Number(match[2]);
}

/** Write one version into every place, and the Android version code that goes with it. */
export function writeVersion(version) {
  for (const { file, pattern } of places) {
    const path = join(root, file);
    let text = readFileSync(path, 'utf8').replace(pattern, `$1${version}$3`);
    if (file === ANDROID_VERSION_FILE) {
      text = text.replace(ANDROID_CODE, `$1${androidVersionCode(version)}$3`);
    }
    writeFileSync(path, text);
  }
}

/** `v0.2.0+20261023` -> { version: '0.2.0', build: '20261023', prerelease: false }. */
export function parseTag(tag) {
  const [core, build = ''] = tag.replace(/^v/, '').split('+');
  if (!SEMVER.test(core)) throw new Error(`not a release tag: ${tag}`);
  return { version: core, build, prerelease: core.includes('-') };
}
