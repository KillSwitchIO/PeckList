// Keeps the docs in step with the server:
//   - every setting in SettingsCatalog.cs is described in docs/configuration/reference.md
//   - every command in the CLI's usage text has a section in docs/reference/cli.md
//   - docs/reference/cli-usage.txt is exactly the usage text `punchlist help` prints
//   node scripts/check-docs.mjs           check (CI)
//   node scripts/check-docs.mjs --write   refresh cli-usage.txt after changing the CLI

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './versions.mjs';

const read = (path) => readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n');
const problems = [];

// Settings: fixed keys, plus each provider key as OIDC_<NAME>_<SUFFIX>.
const catalog = read('server/src/PeckList.Core/Configuration/SettingsCatalog.cs');
const fixed = [...catalog.matchAll(/new\("([A-Z0-9_]+)",/g)].map((match) => match[1]);
const perProvider = [...catalog.matchAll(/new\(prefix \+ "([A-Z0-9_]+)",/g)].map(
  (match) => `OIDC_<NAME>_${match[1]}`,
);
if (fixed.length < 20 || perProvider.length < 5) problems.push('could not read SettingsCatalog.cs');
const reference = read('docs/configuration/reference.md');
for (const key of [...fixed, ...perProvider]) {
  if (!reference.includes(`\`${key}\``)) {
    problems.push(`docs/configuration/reference.md does not describe ${key}`);
  }
}

// The CLI's usage text, as the program prints it.
const cli = read('server/src/PeckList.Server/Cli.cs');
const block = /Usage = """\n([\s\S]*?)\n\s*""";/.exec(cli);
if (!block) {
  problems.push('could not read the usage text in Cli.cs');
} else {
  const lines = block[1].split('\n');
  const indent = Math.min(...lines.filter((line) => line.trim()).map((line) => line.search(/\S/)));
  const usage = `${lines.map((line) => line.slice(indent)).join('\n')}\n`;
  const usageFile = 'docs/reference/cli-usage.txt';
  if (process.argv.includes('--write')) {
    writeFileSync(join(root, usageFile), usage);
    console.log(`wrote ${usageFile}`);
  } else if (read(usageFile) !== usage) {
    problems.push(`${usageFile} differs from Cli.cs: run node scripts/check-docs.mjs --write`);
  }

  // Each command (a line starting with two spaces and a lowercase word) has a ### heading.
  const page = read('docs/reference/cli.md');
  const commands = new Set(
    usage
      .split('\n')
      .filter((line) => /^ {2}[a-z-]/.test(line))
      .map((line) => {
        const words = line.trim().split(/\s+/);
        return ['admin', 'oidc', 'config'].includes(words[0])
          ? `${words[0]} ${words[1]}`
          : words[0];
      }),
  );
  commands.add('--version');
  for (const command of commands) {
    if (!page.includes(`### \`${command}\``)) {
      problems.push(`docs/reference/cli.md has no section for ${command}`);
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
console.log(`Docs cover ${fixed.length + perProvider.length} settings and the CLI.`);
