// A release commit's native downloads and APK, into the generic package registry under
// <version>-<commit>, where cut-release links them. The commit is in the name because a candidate
// that failed on test can be prepared again under the same version.
//   node scripts/ci/upload-downloads.mjs dist

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { packageUrl } from './release-page.mjs';
import { readVersions } from '../versions.mjs';

const { CI_API_V4_URL, CI_PROJECT_ID, CI_JOB_TOKEN, CI_COMMIT_SHORT_SHA } = process.env;
const dir = process.argv[2] ?? 'dist';
const api = `${CI_API_V4_URL}/projects/${CI_PROJECT_ID}`;
const [{ version }] = readVersions();
const packageVersion = `${version}-${CI_COMMIT_SHORT_SHA}`;

const files = readdirSync(dir).filter(
  (file) => /^pecklist-.+\.(tar\.gz|zip|apk)$/.test(file) || file === 'SHA256SUMS',
);
if (files.length === 0) throw new Error(`nothing to upload in ${dir}`);
for (const file of files) {
  const response = await fetch(packageUrl(api, packageVersion, file), {
    method: 'PUT',
    headers: { 'JOB-TOKEN': CI_JOB_TOKEN },
    body: new Uint8Array(readFileSync(join(dir, file))),
  });
  if (!response.ok)
    throw new Error(`Uploading ${file}: ${response.status} ${await response.text()}`);
  console.log(`uploaded ${file}`);
}
