// Put the image a pipeline just built on a server (docs/development/ci.md): bump the pin in the
// compose repository, start its pipeline with the release switched on, and wait for the result, so
// a green job means the server took the image. Runs with GITLAB_API_TOKEN (api scope) and the CI_*
// variables. By default the test server, with main's sha-<commit> image after e2e-server;
// COMPOSE_SERVICE and IMAGE point it at another service, such as the website (pecklist-site) or the
// demo (pecklist-demo, from a release tag: its version). Production is refused: see SERVICES_REFUSED.
//
// The compose repository stays the record of what runs where: the bump is a commit on its main,
// with [skip ci] so the push starts nothing; the pipeline is started by this script instead, with
// RELEASE=<service> and AUTO_RELEASE=true, which its generate step turns into an automatic
// release job (scripts/generate-releases.sh there).

import { pathToFileURL } from 'node:url';

/** Only a release reaches production, and never through here (docs/development/releasing.md). */
const SERVICES_REFUSED = new Set(['pecklist']);

const POLL_MS = 15_000;
const WAIT_MS = 25 * 60_000;

/** `sha-<commit>` or a release's version, with the digest when the build recorded one. */
export function targetOf({ tag, shortSha, digest }) {
  const name = tag ? tag.replace(/^v/, '').replace(/\+.*$/, '') : `sha-${shortSha}`;
  return digest ? `${name}@${digest}` : name;
}

/** The compose file with its image pinned to `target`, and what it was pinned to before. */
export function pinImage(current, image, target) {
  const line = new RegExp(`^(\\s*image: ${image.replaceAll('.', '\\.')}:)(\\S+)$`, 'm');
  const match = line.exec(current);
  if (!match) return null;
  return { was: match[2], updated: current.replace(line, `$1${target}`) };
}

/** Where a compose pipeline stands for one service: 'waiting', 'success', or why it went wrong. */
export function releaseState(parentStatus, childJobs, service) {
  const job = childJobs?.find((each) => each.name === `release:${service}`);
  if (job?.status === 'success') return { done: true, ok: true };
  if (job && ['failed', 'canceled', 'skipped'].includes(job.status)) {
    return { done: true, ok: false, why: `release:${service} ${job.status}: ${job.web_url}` };
  }
  // A failed parent before the release job exists means compose's own checks refused.
  if (!job && ['failed', 'canceled', 'skipped'].includes(parentStatus)) {
    return { done: true, ok: false, why: `the compose pipeline ${parentStatus} before releasing` };
  }
  return { done: false };
}

async function main() {
  const {
    GITLAB_API_TOKEN,
    CI_API_V4_URL = 'https://gitlab.com/api/v4',
    CI_COMMIT_SHORT_SHA,
    CI_COMMIT_TAG,
    CI_COMMIT_SHA,
    CI_ENVIRONMENT_URL,
    CI_PIPELINE_URL,
    COMPOSE_PROJECT = 'homelab-killswitch/compose',
    COMPOSE_SERVICE = 'pecklist-test',
    IMAGE = 'registry.gitlab.com/killswitch10/pecklist',
    IMAGE_DIGEST,
    IMAGE_VERSION,
  } = process.env;

  if (!GITLAB_API_TOKEN || !CI_COMMIT_SHORT_SHA) {
    console.error('deploy-test needs GITLAB_API_TOKEN and CI_COMMIT_SHORT_SHA.');
    process.exit(2);
  }
  if (SERVICES_REFUSED.has(COMPOSE_SERVICE)) {
    console.error(`${COMPOSE_SERVICE} only moves through a release, never through this script.`);
    process.exit(2);
  }

  const project = encodeURIComponent(COMPOSE_PROJECT);
  const file = `services/${COMPOSE_SERVICE}/compose.yaml`;
  const headers = { 'PRIVATE-TOKEN': GITLAB_API_TOKEN, 'Content-Type': 'application/json' };

  async function api(path, init = {}) {
    const response = await fetch(`${CI_API_V4_URL}/projects/${project}/${path}`, {
      ...init,
      headers,
    });
    if (!response.ok)
      throw new Error(
        `${init.method ?? 'GET'} ${path}: ${response.status} ${await response.text()}`,
      );
    return response.json();
  }

  const target = targetOf({
    tag: CI_COMMIT_TAG,
    shortSha: CI_COMMIT_SHORT_SHA,
    digest: IMAGE_DIGEST,
  });
  const current = Buffer.from(
    (await api(`repository/files/${encodeURIComponent(file)}?ref=main`)).content,
    'base64',
  ).toString('utf8');
  const pinned = pinImage(current, IMAGE, target);
  if (!pinned) throw new Error(`${file} has no image line for ${IMAGE}`);
  if (pinned.was === target) {
    console.log(`${COMPOSE_SERVICE} already pins ${target}.`);
  } else {
    await api('repository/commits', {
      method: 'POST',
      body: JSON.stringify({
        branch: 'main',
        commit_message:
          `feat(${COMPOSE_SERVICE}): run ${target.split('@')[0]} [skip ci]\n\n` +
          `PeckList ${CI_COMMIT_TAG ?? 'main'} at ${CI_COMMIT_SHA}, deployed by its pipeline ${CI_PIPELINE_URL ?? ''}.\n` +
          `Was ${pinned.was}.`,
        actions: [{ action: 'update', file_path: file, content: pinned.updated }],
      }),
    });
    console.log(`${file}: ${pinned.was} -> ${target}`);
  }

  const pipeline = await api('pipeline', {
    method: 'POST',
    body: JSON.stringify({
      ref: 'main',
      variables: [
        { key: 'RELEASE', value: COMPOSE_SERVICE },
        { key: 'AUTO_RELEASE', value: 'true' },
      ],
    }),
  });
  console.log(`Compose pipeline ${pipeline.id} started: ${pipeline.web_url}`);

  // The release job sits in a child pipeline, and the parent's status does not follow it, so the
  // job itself is what says whether the server took the image.
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const parent = await api(`pipelines/${pipeline.id}`);
    const bridges = await api(`pipelines/${pipeline.id}/bridges`);
    const child = bridges.find((each) => each.downstream_pipeline)?.downstream_pipeline;
    const jobs = child ? await api(`pipelines/${child.id}/jobs?per_page=100`) : null;
    const state = releaseState(parent.status, jobs, COMPOSE_SERVICE);
    if (state.done) {
      if (!state.ok) throw new Error(`${COMPOSE_SERVICE} did not take ${target}: ${state.why}`);
      break;
    }
    if (Date.now() > deadline) throw new Error(`No result from ${pipeline.web_url} in time.`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  console.log(`${COMPOSE_SERVICE} released ${target}.`);

  // A check from outside the deploy, where the runner can reach the server at all.
  if (CI_ENVIRONMENT_URL && IMAGE_VERSION) {
    const info = await fetch(`${CI_ENVIRONMENT_URL}/api/info`, {
      signal: AbortSignal.timeout(15_000),
    })
      .then((response) => response.json())
      .catch((error) => {
        console.log(`Could not read ${CI_ENVIRONMENT_URL}/api/info from here: ${error.message}`);
        return null;
      });
    if (info && info.version !== IMAGE_VERSION) {
      throw new Error(`${CI_ENVIRONMENT_URL} says ${info.version}, expected ${IMAGE_VERSION}.`);
    }
    if (info) console.log(`${CI_ENVIRONMENT_URL} says ${info.version}.`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
