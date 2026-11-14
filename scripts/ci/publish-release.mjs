// CI, only for a tag built the old way (LEGACY_TAG_BUILD=true): upload the native downloads to the
// project's generic package registry and create (or update) the GitLab release for the tag, with
// notes from CHANGELOG.md. A normal release goes through cut-release.mjs instead.
// Uses the job token, so no secret needs configuring. Run from the repository root:
//   node scripts/ci/publish-release.mjs dist

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  describeRelease,
  downloadLinks,
  isDownload,
  packageUrl,
  versionedName,
  versionedSums,
} from './release-page.mjs';
import { releaseNotes } from '../release-notes.mjs';
import { parseTag, root } from '../versions.mjs';

const env = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (this runs in a GitLab tag pipeline)`);
  return value;
};

const tag = env('CI_COMMIT_TAG');
const api = `${env('CI_API_V4_URL')}/projects/${env('CI_PROJECT_ID')}`;
const headers = { 'JOB-TOKEN': env('CI_JOB_TOKEN') };
const image = env('CI_REGISTRY_IMAGE');
const projectUrl = env('CI_PROJECT_URL');
const { version, prerelease } = parseTag(tag);
const dir = process.argv[2] ?? 'dist';

async function call(method, url, body) {
  const response = await fetch(url, {
    method,
    headers:
      body instanceof Uint8Array ? headers : { ...headers, 'Content-Type': 'application/json' },
    body: body instanceof Uint8Array ? body : body && JSON.stringify(body),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`${method} ${url}: ${response.status} ${await response.text()}`);
  }
  return response;
}

// 1. The downloads, as a generic package named after the version.
const files = readdirSync(dir).filter(isDownload);
if (files.length === 0) throw new Error(`nothing to publish in ${dir}`);
for (const file of files) {
  const saved = versionedName(file, version);
  const bytes = readFileSync(join(dir, file));
  await call(
    'PUT',
    packageUrl(api, version, saved),
    new Uint8Array(
      file === 'SHA256SUMS' ? Buffer.from(versionedSums(bytes.toString('utf8'), version)) : bytes,
    ),
  );
  console.log(`uploaded ${saved}`);
}
const links = downloadLinks(api, version, version, files);
links.push({
  name: `Container image ${image}:${version}`,
  url: `${projectUrl}/container_registry`,
  link_type: 'image',
});

// 2. The release.
const notes = releaseNotes(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), version) ?? '';
const description = describeRelease({ notes, image, version, prerelease, projectUrl });

const existing = await call('GET', `${api}/releases/${encodeURIComponent(tag)}`);
if (existing.status === 404) {
  await call('POST', `${api}/releases`, {
    tag_name: tag,
    name: `PeckList ${version}`,
    description,
    assets: { links },
  });
  console.log(`created release ${tag}`);
} else {
  // A re-run: refresh the notes, and add any link the first run did not get to.
  await call('PUT', `${api}/releases/${encodeURIComponent(tag)}`, {
    name: `PeckList ${version}`,
    description,
  });
  const have = new Set((await existing.json()).assets.links.map((link) => link.name));
  for (const link of links.filter((each) => !have.has(each.name))) {
    await call('POST', `${api}/releases/${encodeURIComponent(tag)}/assets/links`, link);
  }
  console.log(`updated release ${tag}`);
}
