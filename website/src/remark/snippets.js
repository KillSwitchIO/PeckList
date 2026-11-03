// `--8<-- "examples/docker/compose.yaml"` alone in a code block pulls that repository file in at
// build time, so the docs show the example files as they are and never drift from them. A missing
// file fails the build. Paths are from the repository root.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LINE = /^--8<-- "([^"]+)"$/;

function walk(node, root) {
  if (node.type === 'code' && typeof node.value === 'string') {
    node.value = node.value
      .split('\n')
      .map((line) => {
        const match = LINE.exec(line.trim());
        return match
          ? readFileSync(resolve(root, match[1]), 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '')
          : line;
      })
      .join('\n');
  }
  for (const child of node.children ?? []) walk(child, root);
}

/** @param {{ root: string }} options */
export default function snippets({ root }) {
  return (tree) => walk(tree, root);
}
