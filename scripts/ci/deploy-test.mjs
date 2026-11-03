// Put the image a pipeline just built on a server (docs/development/ci.md): bump the tag in the
// compose repository and start its pipeline with the release switched on. Runs with
// GITLAB_API_TOKEN (api scope) and the CI_* variables. By default the test server, with main's
// sha-<commit> image after e2e-server; COMPOSE_SERVICE and IMAGE point it at another service, such
// as the website (pecklist-site) or the demo (punchlist-demo, from a release tag: its version).
//
// The compose repository stays the record of what runs where: the bump is a commit on its main,
// with [skip ci] so the push starts nothing; the pipeline is started by this script instead, with
// RELEASE=<service> and AUTO_RELEASE=true, which its generate step turns into an automatic
// release job (scripts/generate-releases.sh there).

const {
  GITLAB_API_TOKEN,
  CI_API_V4_URL = 'https://gitlab.com/api/v4',
  CI_COMMIT_SHORT_SHA,
  CI_COMMIT_TAG,
  CI_COMMIT_SHA,
  CI_PIPELINE_URL,
  COMPOSE_PROJECT = 'homelab-killswitch/compose',
  COMPOSE_SERVICE = 'punchlist-test',
  IMAGE = 'registry.gitlab.com/killswitch10/punchlist',
} = process.env;

if (!GITLAB_API_TOKEN || !CI_COMMIT_SHORT_SHA) {
  console.error('deploy-test needs GITLAB_API_TOKEN and CI_COMMIT_SHORT_SHA.');
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
    throw new Error(`${init.method ?? 'GET'} ${path}: ${response.status} ${await response.text()}`);
  return response.json();
}

// A release tag (v1.2.3+20261102) deploys the version's image; main deploys its commit's.
const tag = CI_COMMIT_TAG
  ? CI_COMMIT_TAG.replace(/^v/, '').replace(/\+.*$/, '')
  : `sha-${CI_COMMIT_SHORT_SHA}`;
const current = Buffer.from(
  (await api(`repository/files/${encodeURIComponent(file)}?ref=main`)).content,
  'base64',
).toString('utf8');
const line = new RegExp(`^(\\s*image: ${IMAGE.replaceAll('.', '\\.')}:)(\\S+)$`, 'm');
const match = line.exec(current);
if (!match) throw new Error(`${file} has no image line for ${IMAGE}`);
if (match[2] === tag) {
  console.log(`${COMPOSE_SERVICE} already pins ${tag}.`);
} else {
  const updated = current.replace(line, `$1${tag}`);
  await api('repository/commits', {
    method: 'POST',
    body: JSON.stringify({
      branch: 'main',
      commit_message:
        `feat(${COMPOSE_SERVICE}): run ${tag} [skip ci]\n\n` +
        `PeckList ${CI_COMMIT_TAG ?? 'main'} at ${CI_COMMIT_SHA}, deployed by its pipeline ${CI_PIPELINE_URL ?? ''}.\n` +
        `Was ${match[2]}.`,
      actions: [{ action: 'update', file_path: file, content: updated }],
    }),
  });
  console.log(`${file}: ${match[2]} -> ${tag}`);
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
