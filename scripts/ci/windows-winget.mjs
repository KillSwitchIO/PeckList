// The winget manifests of a final release (PL-132), as drafts for Ben's pull request to
// microsoft/winget-pkgs: PeckList.PeckList (the installer) and PeckList.CLI (the command line as a
// portable package, x64 and arm64). Each points at the release's file in the package registry, with
// its SHA-256 from SHA256SUMS.
//   node scripts/ci/windows-winget.mjs <SHA256SUMS> <out folder>
// Writes <out>/manifests/p/PeckList/<PeckList|CLI>/<version>/*.yaml, the layout winget-pkgs uses.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { packageUrl, versionedName } from './release-page.mjs';
import { readVersions } from '../versions.mjs';

export const MANIFEST_VERSION = '1.9.0';
/** The installer's AppId (packaging/windows/pecklist.iss), as Windows lists it under Apps. */
export const PRODUCT_CODE = '{530B9A5D-13F1-4119-8162-394E031D1A11}_is1';

/** SHA256SUMS as file -> hash, the hash in capitals as winget writes it. */
export function readSums(text) {
  const sums = new Map();
  for (const line of text.split('\n')) {
    const [hash, file] = line.trim().split(/\s+/);
    if (hash && file) sums.set(file.replace(/^\*/, ''), hash.toUpperCase());
  }
  return sums;
}

/** A YAML scalar: numbers and safe text plain, anything else single-quoted. */
function scalar(item) {
  if (typeof item === 'number') return String(item);
  const text = String(item);
  return /^[\w.\-/:@+ ]+$/.test(text) && !/^[\d.]+$/.test(text) && !text.includes(': ')
    ? text
    : `'${text.replaceAll("'", "''")}'`;
}

function emitMap(map, indent, out) {
  for (const [key, item] of Object.entries(map)) {
    const pad = ' '.repeat(indent);
    if (Array.isArray(item)) {
      out.push(`${pad}${key}:`);
      emitList(item, indent, out);
    } else if (item && typeof item === 'object') {
      out.push(`${pad}${key}:`);
      emitMap(item, indent + 2, out);
    } else {
      out.push(`${pad}${key}: ${scalar(item)}`);
    }
  }
}

// Lists as winget-pkgs writes them: the dash at the key's indent.
function emitList(list, indent, out) {
  const pad = ' '.repeat(indent);
  for (const item of list) {
    if (item && typeof item === 'object') {
      const lines = [];
      emitMap(item, indent + 2, lines);
      lines[0] = `${pad}- ${lines[0].slice(indent + 2)}`;
      out.push(...lines);
    } else {
      out.push(`${pad}- ${scalar(item)}`);
    }
  }
}

export function yaml(fields) {
  const out = ["# Created by PeckList's release pipeline (scripts/ci/windows-winget.mjs)."];
  emitMap(fields, 0, out);
  return `${out.join('\n')}\n`;
}

const locale = (id, version, name, short, description, tags) => ({
  PackageIdentifier: id,
  PackageVersion: version,
  PackageLocale: 'en-US',
  Publisher: 'PeckList',
  PublisherUrl: 'https://pecklist.com',
  PublisherSupportUrl: 'https://docs.pecklist.com/about/support',
  PackageName: name,
  PackageUrl: 'https://pecklist.com',
  License: 'AGPL-3.0-or-later',
  LicenseUrl: 'https://gitlab.com/killswitch10/pecklist/-/blob/main/LICENSE',
  ShortDescription: short,
  Description: description,
  Moniker: id === 'PeckList.CLI' ? 'pecklist-cli' : 'pecklist',
  Tags: tags,
  ReleaseNotesUrl: 'https://gitlab.com/killswitch10/pecklist/-/blob/main/CHANGELOG.md',
  Documentations: [{ DocumentLabel: 'Documentation', DocumentUrl: 'https://docs.pecklist.com' }],
  ManifestType: 'defaultLocale',
  ManifestVersion: MANIFEST_VERSION,
});

/**
 * The two packages' manifest files, by path under manifests/p/PeckList.
 * @param {{ version: string, sums: Map<string, string>, url: (file: string) => string, date: string }} input
 */
export function manifests({ version, sums, url, date }) {
  if (version.includes('-')) throw new Error(`winget gets final releases only, not ${version}`);
  const sum = (file) => {
    const hash = sums.get(file);
    if (!hash) throw new Error(`SHA256SUMS has no ${file}`);
    return hash;
  };
  const files = {};
  const add = (id, folder, installer, loc) => {
    const base = `${folder}/${version}/${id}`;
    files[`${base}.yaml`] = yaml({
      PackageIdentifier: id,
      PackageVersion: version,
      DefaultLocale: 'en-US',
      ManifestType: 'version',
      ManifestVersion: MANIFEST_VERSION,
    });
    files[`${base}.installer.yaml`] = yaml(installer);
    files[`${base}.locale.en-US.yaml`] = yaml(loc);
  };

  add(
    'PeckList.PeckList',
    'PeckList',
    {
      PackageIdentifier: 'PeckList.PeckList',
      PackageVersion: version,
      InstallerType: 'inno',
      Scope: 'machine',
      ElevationRequirement: 'elevatesSelf',
      UpgradeBehavior: 'install',
      ReleaseDate: date,
      // setup-service.ps1 failed: the files are in, the service is not running.
      ExpectedReturnCodes: [{ InstallerReturnCode: 10, ReturnResponse: 'contactSupport' }],
      AppsAndFeaturesEntries: [
        { ProductCode: PRODUCT_CODE, DisplayName: 'PeckList', Publisher: 'PeckList' },
      ],
      Installers: [
        {
          Architecture: 'x64',
          InstallerUrl: url('pecklist-setup-x64.exe'),
          InstallerSha256: sum('pecklist-setup-x64.exe'),
        },
      ],
      ManifestType: 'installer',
      ManifestVersion: MANIFEST_VERSION,
    },
    locale(
      'PeckList.PeckList',
      version,
      'PeckList',
      'Self-hosted tasks and calendar for you, your family and friends: the server, as a Windows service, and the command line.',
      'PeckList is a self-hosted task app with lists, sharing, reminders and a calendar. This installs the server as the PeckList Windows service (data in C:\\ProgramData\\PeckList) and the pecklist command line on PATH. Open http://localhost:8080 afterwards; the admin password is on the last page of the installer and in C:\\ProgramData\\PeckList\\first-admin-password.txt.',
      ['tasks', 'todo', 'self-hosted', 'calendar', 'server'],
    ),
  );

  add(
    'PeckList.CLI',
    'CLI',
    {
      PackageIdentifier: 'PeckList.CLI',
      PackageVersion: version,
      InstallerType: 'zip',
      NestedInstallerType: 'portable',
      ReleaseDate: date,
      Installers: ['x64', 'arm64'].map((arch) => ({
        Architecture: arch,
        NestedInstallerFiles: [
          {
            RelativeFilePath: `pecklist-cli-win-${arch}\\pecklist.exe`,
            PortableCommandAlias: 'pecklist',
          },
        ],
        InstallerUrl: url(`pecklist-cli-win-${arch}-portable.zip`),
        InstallerSha256: sum(`pecklist-cli-win-${arch}-portable.zip`),
      })),
      ManifestType: 'installer',
      ManifestVersion: MANIFEST_VERSION,
    },
    locale(
      'PeckList.CLI',
      version,
      'PeckList command line',
      'The pecklist command: your PeckList tasks, lists and server from a terminal.',
      'The PeckList command line talks to any PeckList server: pecklist login --server https://..., then pecklist tasks add, list, done and more. One file, no .NET needed. The PeckList.PeckList installer includes it too; install one or the other.',
      ['tasks', 'todo', 'cli', 'self-hosted'],
    ),
  );
  return files;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [sumsFile, out] = process.argv.slice(2);
  if (!sumsFile || !out) throw new Error('usage: windows-winget.mjs <SHA256SUMS> <out folder>');
  const { CI_API_V4_URL, CI_PROJECT_ID, CI_COMMIT_SHORT_SHA } = process.env;
  const [{ version }] = readVersions();
  const api = `${CI_API_V4_URL}/projects/${CI_PROJECT_ID}`;
  const files = manifests({
    version,
    sums: readSums(readFileSync(sumsFile, 'utf8')),
    url: (file) =>
      packageUrl(api, `${version}-${CI_COMMIT_SHORT_SHA}`, versionedName(file, version)),
    date: new Date().toISOString().slice(0, 10),
  });
  for (const [path, text] of Object.entries(files)) {
    const target = join(out, 'manifests', 'p', 'PeckList', path);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, text);
    console.log(`wrote ${target}`);
  }
}
