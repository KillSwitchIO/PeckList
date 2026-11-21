// THIRD-PARTY-NOTICES.md: the third-party software inside PeckList's web app, Android app and
// server, by license. Made from pnpm's list of the production packages of web/ and mobile/, and
// from scripts/third-party.json for the NuGet and Android libraries.
//   node scripts/notices.mjs           write THIRD-PARTY-NOTICES.md
//   node scripts/notices.mjs --check   fail when it is out of date, a package's license isn't one
//                                      the AGPL can take in (third-party.json's allowed), or an
//                                      Android or direct NuGet dependency is missing from the JSON
// Names only, no versions, so an update of a package already listed changes nothing here.
// ThirdPartyNoticesTests (PeckList.Core.Tests) checks the transitive NuGet packages.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './versions.mjs';

const OUT = 'THIRD-PARTY-NOTICES.md';
const check = process.argv.includes('--check');
const read = (path) => readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n');
const inventory = JSON.parse(read('scripts/third-party.json'));
const allowed = new Set(inventory.allowed);
const problems = [];

/** npm: license to package names, for the web app and the Android shell's production packages. */
function npmPackages() {
  const args = [
    'licenses',
    'list',
    '--prod',
    '--json',
    '--filter',
    '@pecklist/web',
    '--filter',
    '@pecklist/mobile',
  ];
  const options = { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 };
  let answer;
  try {
    answer = execFileSync('pnpm', args, options);
  } catch (error) {
    // A Windows pnpm that is a .cmd shim starts only through a shell (the arguments are fixed).
    if (process.platform !== 'win32' || !['ENOENT', 'EINVAL'].includes(error.code)) throw error;
    answer = execFileSync('pnpm', args, { ...options, shell: true });
  }
  const byLicense = new Map();
  for (const [license, packages] of Object.entries(JSON.parse(answer))) {
    const names = byLicense.get(license) ?? new Set();
    for (const each of packages) {
      // The project's own packages are PeckList, not third-party.
      if (!each.name.startsWith('@pecklist/')) names.add(each.name);
    }
    if (names.size > 0) byLicense.set(license, names);
  }
  return byLicense;
}

/** Group "name": "license" pairs by license. */
function byLicense(entries) {
  const grouped = new Map();
  for (const [name, license] of Object.entries(entries)) {
    grouped.set(license, (grouped.get(license) ?? new Set()).add(name));
  }
  return grouped;
}

/** Android libraries the app and Capacitor's Android parts name in their Gradle files. */
function gradleLibraries() {
  const files = ['mobile/android/app/build.gradle'];
  const capacitor = join(root, 'mobile/node_modules/@capacitor');
  if (existsSync(capacitor)) {
    for (const plugin of readdirSync(capacitor)) {
      for (const path of ['android/build.gradle', 'android/capacitor/build.gradle']) {
        const file = `mobile/node_modules/@capacitor/${plugin}/${path}`;
        if (existsSync(join(root, file))) files.push(file);
      }
    }
  }
  const found = new Set();
  for (const file of files) {
    for (const match of read(file).matchAll(/implementation\s+["']([\w.-]+:[\w.-]+):/g)) {
      found.add(match[1]);
    }
  }
  return found;
}

/** NuGet packages the server's projects reference directly (the tests' own are not shipped). */
function directNuget() {
  const found = new Set();
  const src = join(root, 'server/src');
  for (const project of readdirSync(src)) {
    const file = `server/src/${project}/${project}.csproj`;
    if (!existsSync(join(root, file))) continue;
    for (const match of read(file).matchAll(/<PackageReference\s+Include="([^"]+)"/g)) {
      found.add(match[1]);
    }
  }
  return found;
}

const npm = npmPackages();
const nuget = byLicense(inventory.nuget);
const android = byLicense(inventory.android);

for (const [part, grouped] of [
  ['npm', npm],
  ['NuGet', nuget],
  ['Android', android],
]) {
  for (const [license, names] of grouped) {
    if (!allowed.has(license)) {
      problems.push(
        `${part}: ${[...names].join(', ')} under ${license}, which is not in third-party.json's allowed`,
      );
    }
  }
}
for (const name of directNuget()) {
  if (!(name in inventory.nuget))
    problems.push(`NuGet: ${name} is not in scripts/third-party.json`);
}
for (const name of gradleLibraries()) {
  if (!(name in inventory.android))
    problems.push(`Android: ${name} is not in scripts/third-party.json`);
}

const section = (title, intro, grouped) => {
  const lines = [`## ${title}`, '', intro, ''];
  const licenses = [...grouped.keys()].sort(
    (a, b) => grouped.get(b).size - grouped.get(a).size || a.localeCompare(b),
  );
  for (const license of licenses) {
    const names = [...grouped.get(license)].sort((a, b) => a.localeCompare(b, 'en'));
    lines.push(
      `### ${license} (${names.length})`,
      '',
      names.map((name) => `\`${name}\``).join(', '),
      '',
    );
  }
  return lines;
};

const text = [
  '# Third-party notices',
  '',
  'PeckList is free software under the GNU AGPL-3.0-or-later (`LICENSE`). It is built with the',
  'third-party software below, each under its own license, which comes with the package. This file',
  'is made by `node scripts/notices.mjs` and checked in CI; do not edit it by hand.',
  '',
  ...section(
    'Web app and Android app (npm)',
    'The production packages of the web app, which the server and the Android app also serve, and of the Android shell.',
    npm,
  ),
  ...section(
    'Server, command line and keys service (NuGet)',
    'The .NET packages the server projects use.',
    nuget,
  ),
  ...section(
    'Android app (Gradle)',
    'The Android libraries the app and Capacitor name, and with them the AndroidX and Kotlin libraries they depend on (Apache-2.0).',
    android,
  ),
  '## Platform',
  '',
  ...Object.entries(inventory.platform).map(([name, license]) => `- ${name}: ${license}`),
  "- The container image is built on Microsoft's ASP.NET Core image (Ubuntu, chiseled), whose",
  '  packages are under their own licenses.',
  '',
].join('\n');

if (check) {
  const current = existsSync(join(root, OUT)) ? read(OUT) : '';
  if (current !== text) problems.push(`${OUT} is out of date: run node scripts/notices.mjs`);
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log(
    `${OUT} is up to date: ${[...npm.values(), ...nuget.values(), ...android.values()].reduce((sum, names) => sum + names.size, 0)} packages.`,
  );
} else {
  writeFileSync(join(root, OUT), text);
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log(`Wrote ${OUT}.`);
}
