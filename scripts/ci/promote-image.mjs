// A release tag's pipeline builds no image. This puts the release's names (X.Y.Z, X.Y, latest) on
// the digest its main pipeline built and the test server ran, by copying the manifest's exact bytes,
// which cannot change a digest. It refuses a tag with no release, or an image stamped with another
// version or commit, so a tag pushed by hand on some other commit promotes nothing.

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { digestOfRelease } from './release-page.mjs';
import { parseTag } from '../versions.mjs';

const MANIFESTS = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

/** The tags a release gets: a pre-release only its exact one. */
export function promotedTags(version, prerelease) {
  if (prerelease) return [version];
  return [version, version.split('.').slice(0, 2).join('.'), 'latest'];
}

/** What is wrong with the image's own labels for this release; null when they match. */
export function labelProblem(labels, version, revision) {
  const found = labels?.['org.opencontainers.image.version'];
  if (found !== version) return `The image says version ${found ?? 'nothing'}, not ${version}.`;
  const built = labels?.['org.opencontainers.image.revision'];
  if (built !== revision) return `The image was built from ${built ?? 'nothing'}, not ${revision}.`;
  return null;
}

async function registryToken() {
  const { CI_REGISTRY, CI_REGISTRY_USER, CI_REGISTRY_PASSWORD, CI_PROJECT_PATH } = process.env;
  const challenge =
    (await fetch(`https://${CI_REGISTRY}/v2/`)).headers.get('www-authenticate') ?? '';
  const realm = /realm="([^"]+)"/.exec(challenge)?.[1];
  const service = /service="([^"]+)"/.exec(challenge)?.[1];
  if (!realm || !service) throw new Error(`No login offered by the registry: ${challenge}`);
  const url = new URL(realm);
  url.searchParams.set('service', service);
  url.searchParams.set('scope', `repository:${CI_PROJECT_PATH.toLowerCase()}:pull,push`);
  const basic = Buffer.from(`${CI_REGISTRY_USER}:${CI_REGISTRY_PASSWORD}`).toString('base64');
  const response = await fetch(url, { headers: { Authorization: `Basic ${basic}` } });
  if (!response.ok) throw new Error(`Registry login: ${response.status} ${await response.text()}`);
  const { token } = await response.json();
  return token;
}

async function main() {
  const { CI_API_V4_URL, CI_COMMIT_SHA, CI_COMMIT_TAG, CI_JOB_TOKEN, CI_PROJECT_ID } = process.env;
  const { CI_PROJECT_PATH, CI_REGISTRY } = process.env;
  const { version, prerelease } = parseTag(CI_COMMIT_TAG);

  const answer = await fetch(
    `${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/releases/${encodeURIComponent(CI_COMMIT_TAG)}`,
    { headers: { 'JOB-TOKEN': CI_JOB_TOKEN } },
  );
  if (!answer.ok)
    throw new Error(`${CI_COMMIT_TAG} has no release (${answer.status}). Use cut-release.`);
  const digest = digestOfRelease(await answer.json());
  if (!digest) throw new Error(`The release of ${CI_COMMIT_TAG} names no image digest.`);

  const token = await registryToken();
  const base = `https://${CI_REGISTRY}/v2/${CI_PROJECT_PATH.toLowerCase()}`;
  const auth = { Authorization: `Bearer ${token}` };
  const read = async (reference) => {
    const response = await fetch(`${base}/manifests/${reference}`, {
      headers: { ...auth, Accept: MANIFESTS },
    });
    if (!response.ok) throw new Error(`Reading ${reference}: ${response.status}`);
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      type: response.headers.get('content-type'),
    };
  };

  const manifest = await read(digest);
  const actual = `sha256:${createHash('sha256').update(manifest.bytes).digest('hex')}`;
  if (actual !== digest) throw new Error(`The registry returned ${actual} for ${digest}.`);

  // The labels are on one platform's image; attestations are listed beside them as "unknown".
  const index = JSON.parse(manifest.bytes.toString('utf8'));
  const one =
    index.manifests?.find((each) => each.platform?.os && each.platform.os !== 'unknown')?.digest ??
    digest;
  const image = JSON.parse((await read(one)).bytes.toString('utf8'));
  const blob = await fetch(`${base}/blobs/${image.config.digest}`, { headers: auth });
  if (!blob.ok) throw new Error(`Reading the image's config: ${blob.status}`);
  const problem = labelProblem((await blob.json()).config?.Labels, version, CI_COMMIT_SHA);
  if (problem) throw new Error(problem);

  for (const tag of promotedTags(version, prerelease)) {
    const response = await fetch(`${base}/manifests/${tag}`, {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': manifest.type },
      body: manifest.bytes,
    });
    if (!response.ok) throw new Error(`Naming ${tag}: ${response.status} ${await response.text()}`);
    const named = response.headers.get('docker-content-digest');
    if (named !== digest) throw new Error(`${tag} became ${named}, not ${digest}.`);
    console.log(`${tag} -> ${digest}`);
  }
  writeFileSync('promote.env', `IMAGE_DIGEST=${digest}\nIMAGE_VERSION=${version}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
