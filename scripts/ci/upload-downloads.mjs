// A release commit's native downloads and APK, into the generic package registry under
// <version>-<commit>, where cut-release links them. The commit is in the name because a candidate
// that failed on test can be prepared again under the same version. A final release's APK also goes
// under the plain version, for F-Droid (uploadTargets).
//   node scripts/ci/upload-downloads.mjs dist --sums-only   writes dist/release/SHA256SUMS, as served
//   node scripts/ci/upload-downloads.mjs dist               uploads, with SHA256SUMS.sigstore.json
//                                                           when the job signed it (sigstore.sh)

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SUMS_BUNDLE,
  packageUrl,
  uploadTargets,
  versionedName,
  versionedSums,
} from './release-page.mjs';
import { readVersions } from '../versions.mjs';

const { CI_API_V4_URL, CI_PROJECT_ID, CI_JOB_TOKEN, CI_COMMIT_SHORT_SHA } = process.env;
const dir = process.argv[2] ?? 'dist';
const api = `${CI_API_V4_URL}/projects/${CI_PROJECT_ID}`;
const [{ version }] = readVersions();

// What people download as SHA256SUMS: each file named both ways. The signature is of these bytes.
const served = versionedSums(readFileSync(join(dir, 'SHA256SUMS'), 'utf8'), version);
if (process.argv.includes('--sums-only')) {
  mkdirSync(join(dir, 'release'), { recursive: true });
  writeFileSync(join(dir, 'release', 'SHA256SUMS'), served);
  console.log(`wrote ${join(dir, 'release', 'SHA256SUMS')}`);
  process.exit(0);
}
const signedSums = join(dir, 'release', 'SHA256SUMS');
if (existsSync(join(dir, SUMS_BUNDLE)) && readFileSync(signedSums, 'utf8') !== served) {
  throw new Error(`${SUMS_BUNDLE} signs a different SHA256SUMS than the one being uploaded`);
}

const files = readdirSync(dir).filter(
  (file) =>
    /^pecklist-.+\.(tar\.gz|zip|apk)$/.test(file) || file === 'SHA256SUMS' || file === SUMS_BUNDLE,
);
if (files.length === 0) throw new Error(`nothing to upload in ${dir}`);
for (const { file, packageVersion } of uploadTargets(files, version, CI_COMMIT_SHORT_SHA)) {
  const saved = versionedName(file, version);
  const bytes = readFileSync(join(dir, file));
  const response = await fetch(packageUrl(api, packageVersion, saved), {
    method: 'PUT',
    headers: { 'JOB-TOKEN': CI_JOB_TOKEN },
    body: file === 'SHA256SUMS' ? served : new Uint8Array(bytes),
  });
  if (!response.ok)
    throw new Error(`Uploading ${saved}: ${response.status} ${await response.text()}`);
  console.log(`uploaded ${packageVersion}/${saved}`);
}
