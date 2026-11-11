import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

/** Every project the server builds from, following ProjectReferences, as repo paths. */
function projectsOf(project, seen = new Set()) {
  if (seen.has(project)) return seen;
  seen.add(project);
  for (const [, reference] of read(project).matchAll(/<ProjectReference\s+Include="([^"]+)"/g)) {
    projectsOf(
      posix.normalize(posix.join(posix.dirname(project), reference.replaceAll('\\', '/'))),
      seen,
    );
  }
  return seen;
}

test('the image restores every project the server references before it copies the source', () => {
  const dockerfile = read('Dockerfile');
  const restore = dockerfile.indexOf(
    'RUN dotnet restore src/PeckList.Server/PeckList.Server.csproj',
  );
  assert.ok(restore > 0, 'the Dockerfile restores the server project');
  const copied = new Set(
    [...dockerfile.slice(0, restore).matchAll(/^COPY (server\/src\/\S+\.csproj) /gm)].map(
      (match) => match[1],
    ),
  );
  const missing = [...projectsOf('server/src/PeckList.Server/PeckList.Server.csproj')].filter(
    (project) => !copied.has(project),
  );
  assert.deepEqual(missing, [], 'COPY these into the restore layer');
});
