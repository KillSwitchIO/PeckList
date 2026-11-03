// pnpm test:scripts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  convertPage,
  parseSidebar,
  rewriteLink,
  sidebar,
  wikiPages,
  wikiPath,
} from './wiki-pages.mjs';

const read = (path) =>
  ({ 'examples/a.conf': 'key = 1\n# two\n' })[path] ?? assert.fail(`no ${path}`);

test('doc paths become wiki paths; the home page and section indexes by their folder', () => {
  assert.equal(wikiPath('docs/index.md'), 'home');
  assert.equal(wikiPath('docs/install/docker.md'), 'install/docker');
  assert.equal(wikiPath('docs/configuration/index.md'), 'configuration');
  assert.equal(wikiPath('docs/migrations/README.md'), 'migrations/README');
});

test('relative doc links point at wiki pages from the root; other links stay', () => {
  assert.equal(
    rewriteLink('../guides/security.md#headers', 'docs/install/docker.md'),
    '/guides/security#headers',
  );
  assert.equal(rewriteLink('reverse-proxy.md', 'docs/install/docker.md'), '/install/reverse-proxy');
  assert.equal(rewriteLink('../index.md', 'docs/install/docker.md'), '/home');
  assert.equal(rewriteLink('index.md', 'docs/configuration/reference.md'), '/configuration');
  assert.equal(
    rewriteLink('https://example.com/a.md', 'docs/index.md'),
    'https://example.com/a.md',
  );
  assert.equal(rewriteLink('#local', 'docs/index.md'), '#local');
  assert.equal(rewriteLink('../examples/x.yaml', 'docs/index.md'), '../examples/x.yaml');
});

test('images in the docs point at the repository file, since the wiki has no copy', () => {
  assert.equal(
    rewriteLink('assets/screenshots/list.png', 'docs/index.md'),
    'https://gitlab.com/killswitch10/pecklist/-/raw/main/docs/assets/screenshots/list.png',
  );
  assert.equal(
    rewriteLink('../assets/shot.webp', 'docs/using/index.md'),
    'https://gitlab.com/killswitch10/pecklist/-/raw/main/docs/assets/shot.webp',
  );
});

test('admonitions become alerts, tabs become bold headings, snippets are pasted in', () => {
  const page = [
    '# Title',
    '',
    ':::tip[Missed it?]',
    '',
    'Run `pecklist admin reset-password` ([the CLI](../reference/cli.md#admin)).',
    '',
    '```bash',
    'pecklist admin reset-password',
    '```',
    '',
    ':::',
    '',
    '<Tabs>',
    '<TabItem value="compose-yaml" label="compose.yaml">',
    '',
    '```yaml title="compose.yaml"',
    '--8<-- "examples/a.conf"',
    '```',
    '',
    '</TabItem>',
    '<TabItem value="other" label="Other">',
    '',
    'Press <kbd>Ctrl</kbd>+<kbd>K</kbd>.',
    '',
    '</TabItem>',
    '</Tabs>',
    '',
    '{/* a note for whoever edits this */}',
    'Done.',
    '',
  ].join('\n');
  assert.equal(
    convertPage('docs/guides/x.md', page, read),
    [
      '# Title',
      '',
      '> [!tip] **Missed it?**',
      '> Run `pecklist admin reset-password` ([the CLI](/reference/cli#admin)).',
      '>',
      '> ```bash',
      '> pecklist admin reset-password',
      '> ```',
      '',
      '**compose.yaml**',
      '',
      '**compose.yaml**',
      '',
      '```yaml',
      'key = 1',
      '# two',
      '```',
      '',
      '**Other**',
      '',
      'Press <kbd>Ctrl</kbd>+<kbd>K</kbd>.',
      '',
      'Done.',
      '',
    ].join('\n'),
  );
});

test('links inside fenced code are left alone', () => {
  const page = '```text\nsee [x](../a.md)\n```\n[y](../a.md)\n';
  assert.equal(convertPage('docs/b/c.md', page, read), '```text\nsee [x](../a.md)\n```\n[y](/a)\n');
});

test('the site sidebar becomes the wiki sidebar, sections bold and pages as root links', () => {
  const items = [
    { type: 'doc', id: 'index', label: 'Home' },
    {
      type: 'category',
      label: 'Install',
      items: [
        { type: 'doc', id: 'install/docker', label: 'Docker' },
        { type: 'doc', id: 'install/linux', label: 'Linux' },
      ],
    },
    { type: 'doc', id: 'faq', label: 'FAQ' },
  ];
  assert.deepEqual(parseSidebar(items), [
    { title: 'Home', path: 'index.md' },
    {
      title: 'Install',
      children: [
        { title: 'Docker', path: 'install/docker.md' },
        { title: 'Linux', path: 'install/linux.md' },
      ],
    },
    { title: 'FAQ', path: 'faq.md' },
  ]);
  assert.equal(
    sidebar(parseSidebar(items)),
    '- [Home](/home)\n- **Install**\n  - [Docker](/install/docker)\n  - [Linux](/install/linux)\n- [FAQ](/faq)\n',
  );
});

test('every doc becomes a page with a banner, plus the sidebar', () => {
  const pages = wikiPages({
    docs: new Map([
      ['docs/index.md', '# Hi\n'],
      ['docs/install/docker.md', '# Docker\n'],
    ]),
    sidebar: [
      { type: 'doc', id: 'index', label: 'Home' },
      { type: 'doc', id: 'install/docker', label: 'Docker' },
    ],
    read,
  });
  assert.deepEqual([...pages.keys()], ['home', 'install/docker', '_sidebar']);
  assert.match(pages.get('home'), /^> This page is a copy of \[`docs\/index.md`\]/);
  assert.match(pages.get('install/docker'), /https:\/\/docs.pecklist.com\/next\/install\/docker\//);
});
