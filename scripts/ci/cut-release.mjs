// The cut-release button on a release commit's main pipeline (docs/development/releasing.md): check
// this commit is what it says, then create its protected tag and its whole release page in one call.
// It uses the job token, which acts as whoever pressed the button, so no token is stored for it and
// only someone allowed to create v* tags can do it. No image is built: the tag's pipeline names the
// digest this commit's pipeline already built and tested.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describeRelease, downloadLinks, imageDigestLink } from './release-page.mjs';
import { releaseNotes } from '../release-notes.mjs';
import { readVersions, root } from '../versions.mjs';

const HOUR = 3_600_000;
const SECOND = 1000;

/**
 * When a pre-release counts as released. GitLab's latest-release link goes by this date and knows
 * nothing of pre-releases, and the server's update notice and the install docs both read that link,
 * so a pre-release is dated just before the newest full release, whatever that link says now, and
 * each one a second after the one before it, so the newest shows first. A release is dated now.
 * @param {boolean} prerelease
 * @param {{ tag_name: string, released_at: string }[]} releases the newest releases there are
 */
export function releasedAtFor(prerelease, releases) {
  if (!prerelease) return undefined;
  const isPre = (each) => each.tag_name.split('+')[0].includes('-');
  const at = (each) => Date.parse(each.released_at);
  const full = Math.max(...releases.filter((each) => !isPre(each)).map(at));
  if (!Number.isFinite(full)) return undefined;
  const start = full - HOUR;
  const earlier = releases
    .filter(isPre)
    .map(at)
    .filter((each) => each >= start && each < full);
  const date = earlier.length > 0 ? Math.min(Math.max(...earlier) + SECOND, full - SECOND) : start;
  return new Date(date).toISOString();
}

/**
 * What stands in the way of cutting this commit; empty when nothing does.
 * @param {object} input
 * @param {string[]} input.versions the version each version file holds
 * @param {string} input.message the commit's message
 * @param {string | undefined} input.imageVersion the version the image was stamped with
 * @param {string | undefined} input.digest the digest this commit's pipeline built
 * @param {string[]} input.existingTags tags already holding this version
 * @param {string | null} input.notes the changelog section
 * @param {boolean} input.deployedToTest whether the test server took this commit
 */
export function cutProblems({
  versions,
  message,
  imageVersion,
  digest,
  existingTags,
  notes,
  deployedToTest,
}) {
  const unique = [...new Set(versions)];
  if (unique.length !== 1) return [`The version files differ: ${unique.join(', ')}.`];
  const [version] = unique;
  const problems = [];
  if (!message.split('\n').includes(`chore(release): ${version}`)) {
    problems.push(`This commit is not the release commit for ${version}.`);
  }
  if (imageVersion !== version) {
    problems.push(`The image says ${imageVersion ?? 'nothing'}, not ${version}.`);
  }
  if (!digest) problems.push('This pipeline recorded no image digest.');
  if (existingTags.length > 0) problems.push(`${version} is already released: ${existingTags[0]}.`);
  if (notes === null) problems.push(`CHANGELOG.md has no section for ${version}.`);
  if (!deployedToTest) {
    problems.push('The test server has not taken this commit: retry deploy-test first.');
  }
  return problems;
}

async function main() {
  const {
    CI_API_V4_URL,
    CI_COMMIT_MESSAGE,
    CI_COMMIT_SHA,
    CI_COMMIT_SHORT_SHA,
    CI_JOB_TOKEN,
    CI_PROJECT_ID,
    CI_PROJECT_URL,
    CI_REGISTRY_IMAGE,
    IMAGE_DIGEST,
    IMAGE_VERSION,
  } = process.env;
  const api = `${CI_API_V4_URL}/projects/${CI_PROJECT_ID}`;
  const headers = { 'JOB-TOKEN': CI_JOB_TOKEN };
  const get = async (path) => {
    const response = await fetch(`${api}/${path}`, { headers });
    if (!response.ok) throw new Error(`GET ${path}: ${response.status} ${await response.text()}`);
    return response.json();
  };

  const versions = readVersions().map((each) => each.version);
  const [version] = versions;
  const notes = releaseNotes(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), version);
  const tags = await get(`repository/tags?search=${encodeURIComponent(`^v${version}+`)}`);
  const deployments = await get(
    'deployments?environment=test&status=success&order_by=created_at&sort=desc&per_page=50',
  );
  const problems = cutProblems({
    versions,
    message: CI_COMMIT_MESSAGE,
    imageVersion: IMAGE_VERSION,
    digest: IMAGE_DIGEST,
    existingTags: tags.map((each) => each.name),
    notes,
    deployedToTest: deployments.some((each) => each.sha === CI_COMMIT_SHA),
  });
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    process.exit(1);
  }

  const files = readFileSync(join(root, 'dist', 'SHA256SUMS'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.trim().split(/\s+/)[1].replace(/^\*/, ''));
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const tag = `v${version}+${date}`;
  const prerelease = version.includes('-');
  const releases = prerelease ? await get('releases?order_by=released_at&per_page=100') : [];
  const response = await fetch(`${api}/releases`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: tag,
      ref: CI_COMMIT_SHA,
      tag_message: `PeckList ${version}\n\n${notes}`,
      name: `PeckList ${version}`,
      released_at: releasedAtFor(prerelease, releases),
      description: describeRelease({
        notes,
        image: CI_REGISTRY_IMAGE,
        version,
        prerelease,
        projectUrl: CI_PROJECT_URL,
      }),
      assets: {
        links: [
          ...downloadLinks(api, `${version}-${CI_COMMIT_SHORT_SHA}`, [...files, 'SHA256SUMS']),
          imageDigestLink(CI_REGISTRY_IMAGE, version, IMAGE_DIGEST),
        ],
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`Creating ${tag}: ${response.status} ${await response.text()}`);
  }
  console.log(`Released ${tag} at ${IMAGE_DIGEST}. Its tag pipeline names the image.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
