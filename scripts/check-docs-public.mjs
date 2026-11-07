#!/usr/bin/env node
// The public docs say nothing about the private network this project happens to be run on. Fails when
// a forbidden term appears in the given folders: the docs' sources and the built site, so a config
// or a component that adds one is caught as well.
//
//   node scripts/check-docs-public.mjs docs website/versioned_docs website/build
//
// Two lists. PUBLIC_TERMS are written here because they are public anyway. DOCS_PRIVATE_TERMS, an
// optional CI variable, holds names that should not be written in a public repository, and those are
// never printed: a report names only the file. Its terms are split at commas, new lines or `~`, the
// last because GitLab will not mask a value holding a comma.
//
// The project's own addresses (gitlab.com/ and registry.gitlab.com/ under its group) hold neither
// public term, so they pass without an exception.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PUBLIC_TERMS = ['killswitch10.com', 'homelab-killswitch'];

/** The terms in a DOCS_PRIVATE_TERMS value. Empty or missing is none. */
export function parseTerms(value) {
  return (value ?? '')
    .split(/[,\n~]/)
    .map((term) => term.trim())
    .filter(Boolean);
}

/** Every file under a folder. A folder that is missing throws: a check of nothing must not pass. */
function filesUnder(folder) {
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

/**
 * What the folders hold, as lines safe to print. A private term in a file's name is reported by folder
 * alone, since the name would give the term away.
 */
export function findForbidden(folders, privateTerms = []) {
  const found = [];
  const lowered = (terms) => terms.map((term) => term.toLowerCase());
  const publicTerms = lowered(PUBLIC_TERMS);
  const hidden = lowered(privateTerms);
  for (const folder of folders) {
    for (const file of filesUnder(folder)) {
      const name = relative('.', file).replaceAll('\\', '/');
      const path = name.toLowerCase();
      const text = readFileSync(file, 'utf8').toLowerCase();
      for (const term of publicTerms) {
        if (path.includes(term) || text.includes(term)) found.push(`${name}: ${term}`);
      }
      if (hidden.some((term) => path.includes(term))) {
        found.push(`${folder}: a file name holds a term from DOCS_PRIVATE_TERMS`);
      } else if (hidden.some((term) => text.includes(term))) {
        found.push(`${name}: a term from DOCS_PRIVATE_TERMS`);
      }
    }
  }
  return found;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const folders = process.argv.slice(2);
  if (folders.length === 0) {
    console.error('Name the folders to check.');
    process.exit(2);
  }
  const privateTerms = parseTerms(process.env.DOCS_PRIVATE_TERMS);
  const found = findForbidden(folders, privateTerms);
  if (found.length > 0) {
    console.error(
      `The public docs must not mention these. Take them out:\n${found.map((line) => `  ${line}`).join('\n')}`,
    );
    process.exit(1);
  }
  console.log(
    `Public docs clean: ${folders.join(', ')}. Private terms: ${privateTerms.length > 0 ? 'checked' : 'none set, skipped'}.`,
  );
}
