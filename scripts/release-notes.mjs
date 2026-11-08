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

/**
 * The changelog with `section` (a `## [version]` heading and its body) as its newest entry, under
 * the header. Every older section stays exactly as it was; an Unreleased section, or an earlier
 * section of the same version (a release prepared again), gives way to the new one.
 */
export function withSection(changelog, version, section) {
  const newline = changelog.includes('\r\n') ? '\r\n' : '\n';
  const lines = changelog.split(/\r?\n/);
  const first = lines.findIndex((line) => line.startsWith('## '));
  const header = first < 0 ? lines : lines.slice(0, first);
  const sections = [];
  for (const line of first < 0 ? [] : lines.slice(first)) {
    if (line.startsWith('## ')) sections.push([line]);
    else sections.at(-1).push(line);
  }
  const replaced = (heading) =>
    heading === '## Unreleased' || heading.startsWith(`## [${version}]`);
  const kept = sections.filter(([heading]) => !replaced(heading)).flat();
  const added = section.trim().split(/\r?\n/);
  while (header.length && header.at(-1) === '') header.pop();
  return [...header, '', ...added, '', ...(kept.length ? kept : [''])].join(newline);
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
