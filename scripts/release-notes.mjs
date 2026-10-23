// Print one version's section of CHANGELOG.md (without its heading): the release notes.
//   node scripts/release-notes.mjs 0.2.0

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from './versions.mjs';

/** The body of `## [version]` up to the next `## ` heading, or null when there is none. */
export function releaseNotes(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = process.argv[2];
  if (!version) {
    console.error('Usage: node scripts/release-notes.mjs <version>');
    process.exit(2);
  }
  const notes = releaseNotes(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), version);
  if (notes === null) {
    console.error(`CHANGELOG.md has no section for ${version}.`);
    process.exit(1);
  }
  console.log(notes);
}
