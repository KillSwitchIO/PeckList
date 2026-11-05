// A release's own copy of the docs (Docusaurus versioning, website/): `pnpm release` calls this, so
// docs.pecklist.com shows the docs of the newest release, with the earlier ones and `main` ("Next")
// a menu away. The copy also gets the example files its pages pull in (`--8<-- "path"` lines)
// pasted in place, so an old version keeps showing the examples it shipped with.
//   node scripts/docs-version.mjs 0.7.0
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from './versions.mjs';

const SNIPPET = /^(\s*)--8<-- "([^"]+)"\s*$/;

/** One page with every snippet line replaced by its file, indented as the line was. */
export function expandSnippets(text, read) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  return text
    .split(newline)
    .map((line) => {
      const match = SNIPPET.exec(line);
      if (!match) return line;
      const [, indent, path] = match;
      return read(path)
        .replace(/\r\n/g, '\n')
        .replace(/\n$/, '')
        .split('\n')
        .map((fileLine) => (fileLine ? indent + fileLine : fileLine))
        .join(newline);
    })
    .join(newline);
}

function pages(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return /\.mdx?$/.test(name) ? [path] : [];
  });
}

/** Removes a copy made earlier for this version: a release prepared again copies the docs again. */
function dropVersion(version) {
  const website = join(root, 'website');
  rmSync(join(website, 'versioned_docs', `version-${version}`), { recursive: true, force: true });
  rmSync(join(website, 'versioned_sidebars', `version-${version}-sidebars.json`), { force: true });
  const list = join(website, 'versions.json');
  if (!existsSync(list)) return;
  const versions = JSON.parse(readFileSync(list, 'utf8'));
  if (!versions.includes(version)) return;
  const kept = versions.filter((each) => each !== version);
  writeFileSync(list, `${JSON.stringify(kept, null, 2)}\n`);
}

/** Copies docs/ and the sidebar as `version` (website/versioned_docs/version-<v>) and pastes the snippets in. */
export function versionDocs(version) {
  dropVersion(version);
  execFileSync(
    'pnpm',
    ['--filter', '@pecklist/docs', 'exec', 'docusaurus', 'docs:version', version],
    {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    },
  );
  const read = (path) => readFileSync(join(root, path), 'utf8');
  for (const page of pages(join(root, 'website', 'versioned_docs', `version-${version}`))) {
    const text = readFileSync(page, 'utf8');
    const expanded = expandSnippets(text, read);
    if (expanded !== text) writeFileSync(page, expanded);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = process.argv[2];
  if (!version) {
    console.error('Usage: node scripts/docs-version.mjs <version>');
    process.exit(1);
  }
  versionDocs(version);
}
