import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expandSnippets } from './docs-version.mjs';

const files = {
  'examples/docker/compose.yaml': 'services:\n  pecklist:\n\n    image: x\n',
};
const read = (path) => {
  if (!(path in files)) throw new Error(`no ${path}`);
  return files[path];
};

test('a snippet line becomes the file, without its last newline', () => {
  const page = '```yaml\n--8<-- "examples/docker/compose.yaml"\n```\n';
  assert.equal(
    expandSnippets(page, read),
    '```yaml\nservices:\n  pecklist:\n\n    image: x\n```\n',
  );
});

test('an indented snippet keeps its indent, blank lines stay blank', () => {
  const page = '    ```yaml\n    --8<-- "examples/docker/compose.yaml"\n    ```';
  assert.equal(
    expandSnippets(page, read),
    '    ```yaml\n    services:\n      pecklist:\n\n        image: x\n    ```',
  );
});

test('a page without snippets, or one that only mentions them, is left alone', () => {
  const page = 'Write `--8<-- "path"` to pull a file in.\r\nNothing else.\r\n';
  assert.equal(expandSnippets(page, read), page);
});

test('a missing file fails, so a version never ships a broken page', () => {
  assert.throws(
    () => expandSnippets('--8<-- "examples/gone.yaml"', read),
    /no examples\/gone.yaml/,
  );
});
