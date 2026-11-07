import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findForbidden, parseTerms, PUBLIC_TERMS } from './check-docs-public.mjs';

const SCRIPT = fileURLToPath(new URL('./check-docs-public.mjs', import.meta.url));
const SECRET = 'nas-7.lan.example';

const roots = [];
function folderWith(files) {
  const root = mkdtempSync(join(tmpdir(), 'docs-public-'));
  roots.push(root);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(root, name, '..'), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  return root;
}
after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

function run(root, env = {}) {
  const inherited = { ...process.env };
  delete inherited.DOCS_PRIVATE_TERMS;
  return spawnSync(process.execPath, [SCRIPT, root], {
    encoding: 'utf8',
    env: { ...inherited, ...env },
  });
}

describe('the public docs check', () => {
  for (const term of PUBLIC_TERMS) {
    it(`fails on ${term}, in any case, deep in a folder`, () => {
      const root = folderWith({ 'guides/deep/page.md': `See ${term.toUpperCase()} for more.` });
      const answer = run(root);
      assert.equal(answer.status, 1);
      assert.match(answer.stderr, /page\.md/);
    });
  }

  it("passes the project's own addresses and clean text", () => {
    const root = folderWith({
      'a.md':
        'https://gitlab.com/killswitch10/pecklist and registry.gitlab.com/killswitch10/pecklist:edge',
    });
    assert.equal(run(root).status, 0);
  });

  it('checks a file of any type, such as a built script', () => {
    const root = folderWith({ 'assets/main.abc123.js': `const a="https://x.${PUBLIC_TERMS[0]}/"` });
    assert.equal(run(root).status, 1);
  });

  it('fails on a private term and names the file, never the term', () => {
    const root = folderWith({ 'guides/page.md': `The server at ${SECRET.toUpperCase()} is down.` });
    const answer = run(root, { DOCS_PRIVATE_TERMS: `other.example,${SECRET}` });
    assert.equal(answer.status, 1);
    assert.match(answer.stderr, /page\.md/);
    assert.ok(!`${answer.stdout}${answer.stderr}`.toLowerCase().includes(SECRET));
  });

  it('does not give a private term away through a file name', () => {
    const root = folderWith({ [`${SECRET}.md`]: 'nothing here' });
    const answer = run(root, { DOCS_PRIVATE_TERMS: SECRET });
    assert.equal(answer.status, 1);
    assert.ok(!`${answer.stdout}${answer.stderr}`.toLowerCase().includes(SECRET));
  });

  it('skips the private part when the variable is empty or missing', () => {
    const root = folderWith({ 'a.md': `Mentions ${SECRET}.` });
    assert.equal(run(root).status, 0);
    assert.equal(run(root, { DOCS_PRIVATE_TERMS: '' }).status, 0);
    assert.equal(run(root, { DOCS_PRIVATE_TERMS: ' , \n ~ ' }).status, 0);
  });

  it('fails when a folder is missing, rather than checking nothing', () => {
    const answer = run(join(folderWith({}), 'gone'));
    assert.notEqual(answer.status, 0);
    assert.throws(() => findForbidden([join(folderWith({}), 'gone')]));
  });

  it('splits the variable at commas, new lines and tildes', () => {
    assert.deepEqual(parseTerms(' a.example, b.example\nc.example~d.example '), [
      'a.example',
      'b.example',
      'c.example',
      'd.example',
    ]);
    assert.deepEqual(parseTerms(undefined), []);
  });
});
