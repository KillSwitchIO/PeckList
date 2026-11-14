import assert from 'node:assert/strict';
import test from 'node:test';
import { manifests, PRODUCT_CODE, readSums, yaml } from './ci/windows-winget.mjs';

const sums = readSums(
  [
    'aaaa1111  pecklist-setup-x64.exe',
    'bbbb2222 *pecklist-cli-win-x64-portable.zip',
    'cccc3333  pecklist-cli-win-arm64-portable.zip',
  ].join('\n'),
);
const url = (file) => `https://example.test/0.12.0-abc/${file}`;
const made = () => manifests({ version: '0.12.0', sums, url, date: '2026-11-20' });

test('a final release gets both packages in the layout winget-pkgs uses', () => {
  assert.deepEqual(Object.keys(made()).sort(), [
    'CLI/0.12.0/PeckList.CLI.installer.yaml',
    'CLI/0.12.0/PeckList.CLI.locale.en-US.yaml',
    'CLI/0.12.0/PeckList.CLI.yaml',
    'PeckList/0.12.0/PeckList.PeckList.installer.yaml',
    'PeckList/0.12.0/PeckList.PeckList.locale.en-US.yaml',
    'PeckList/0.12.0/PeckList.PeckList.yaml',
  ]);
});

test("the installer's manifest points at the release's file, its hash and the installed app", () => {
  const text = made()['PeckList/0.12.0/PeckList.PeckList.installer.yaml'];
  assert.match(text, /^InstallerType: inno$/m);
  assert.match(text, /^Scope: machine$/m);
  assert.match(text, /^PackageVersion: '0\.12\.0'$/m);
  assert.match(
    text,
    /^- Architecture: x64\n {2}InstallerUrl: https:\/\/example\.test\/0\.12\.0-abc\/pecklist-setup-x64\.exe\n {2}InstallerSha256: AAAA1111$/m,
  );
  assert.ok(text.includes(`ProductCode: '${PRODUCT_CODE}'`));
  assert.match(text, /^- InstallerReturnCode: 10\n {2}ReturnResponse: contactSupport$/m);
});

test('the command line is a portable package for x64 and arm64, called pecklist', () => {
  const text = made()['CLI/0.12.0/PeckList.CLI.installer.yaml'];
  assert.match(text, /^InstallerType: zip$/m);
  assert.match(text, /^NestedInstallerType: portable$/m);
  for (const [arch, hash] of [
    ['x64', 'BBBB2222'],
    ['arm64', 'CCCC3333'],
  ]) {
    assert.ok(text.includes(`- Architecture: ${arch}\n`));
    assert.ok(
      text.includes(
        `  - RelativeFilePath: 'pecklist-cli-win-${arch}\\pecklist.exe'\n    PortableCommandAlias: pecklist\n`,
      ),
    );
    assert.ok(text.includes(`InstallerSha256: ${hash}`));
  }
});

test('release candidates and missing files make no manifests', () => {
  assert.throws(
    () => manifests({ version: '0.12.0-rc.1', sums, url, date: '2026-11-20' }),
    /final releases only/,
  );
  const partial = readSums('aaaa1111  pecklist-setup-x64.exe');
  assert.throws(
    () => manifests({ version: '0.12.0', sums: partial, url, date: '2026-11-20' }),
    /no pecklist-cli-win-x64-portable\.zip/,
  );
});

test('YAML: plain where safe, quoted otherwise', () => {
  assert.equal(
    yaml({ A: 'plain text', B: '1.2.3', C: "it's: here", D: 7, E: ['x'], F: [{ G: 'y', H: 'z' }] }),
    "# Created by PeckList's release pipeline (scripts/ci/windows-winget.mjs).\n" +
      "A: plain text\nB: '1.2.3'\nC: 'it''s: here'\nD: 7\nE:\n- x\nF:\n- G: y\n  H: z\n",
  );
});
