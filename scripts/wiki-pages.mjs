// The docs (MkDocs Material, docs/ and mkdocs.yml) as GitLab wiki pages: the same pages, with the
// MkDocs-only syntax turned into what GitLab renders (alerts for admonitions, bold headings for
// tabs, the example files pasted in place of snippet lines, <kbd> for keys) and the links pointed
// at wiki pages. The rendered site stays the home of the docs; the wiki is a mirror that CI
// refreshes on every merge (scripts/ci/wiki-sync.mjs, docs/development/ci.md).
//
// Pure: takes the files, returns the pages. The git work is in scripts/ci/wiki-sync.mjs.

const SITE = 'https://killswitch10.gitlab.io/punchlist/';
const SOURCE = 'https://gitlab.com/killswitch10/punchlist/-/blob/main/';

/** Admonition kinds GitLab shows as alerts; anything else becomes a note. */
const ALERTS = {
  note: 'note',
  tip: 'tip',
  warning: 'warning',
  danger: 'caution',
  important: 'important',
};

/** `docs/install/docker.md` -> `install/docker`; a section's `index.md` is the section's page. */
export function wikiPath(docPath) {
  const path = docPath.replace(/^docs\//, '').replace(/\.md$/, '');
  if (path === 'index') return 'home';
  return path.replace(/\/index$/, '');
}

/** The rendered site's address of a doc page. */
export function sitePath(docPath) {
  const path = wikiPath(docPath);
  return path === 'home' ? SITE : `${SITE}${path}/`;
}

/** The `nav:` of mkdocs.yml as a tree: { title, path } leaves, { title, children } sections. */
export function parseNav(mkdocsYaml) {
  const lines = mkdocsYaml.split(/\r?\n/);
  const start = lines.findIndex((line) => /^nav:\s*$/.test(line));
  if (start < 0) throw new Error('mkdocs.yml has no nav');
  const items = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const match = /^(\s*)- (.+?):\s*(\S.*)?$/.exec(line);
    if (!match) break;
    items.push({ depth: match[1].length, title: match[2].trim(), path: match[3]?.trim() ?? null });
  }
  const build = (from, depth) => {
    const nodes = [];
    while (from.index < items.length && items[from.index].depth === depth) {
      const item = items[from.index++];
      if (item.path) nodes.push({ title: item.title, path: item.path });
      else
        nodes.push({ title: item.title, children: build(from, items[from.index]?.depth ?? depth) });
    }
    return nodes;
  };
  return build({ index: 0 }, items[0]?.depth ?? 0);
}

/** The `_sidebar` page: the site's navigation as nested links. */
export function sidebar(nav) {
  const lines = [];
  const walk = (nodes, indent) => {
    for (const node of nodes) {
      if (node.children) {
        lines.push(`${indent}- **${node.title}**`);
        walk(node.children, `${indent}  `);
      } else {
        lines.push(`${indent}- [${node.title}](/${wikiPath(`docs/${node.path}`)})`);
      }
    }
  };
  walk(nav, '');
  return `${lines.join('\n')}\n`;
}

/** A doc-relative link target (`../guides/security.md#x`) as a wiki root link (`/guides/security#x`). */
export function rewriteLink(target, docPath) {
  if (/^[a-z]+:/i.test(target) || target.startsWith('#') || target.startsWith('/')) return target;
  const [file, fragment] = target.split('#');
  if (!file.endsWith('.md')) return target;
  const parts = docPath.split('/').slice(0, -1);
  for (const piece of file.split('/')) {
    if (piece === '..') parts.pop();
    else if (piece !== '.') parts.push(piece);
  }
  return `/${wikiPath(parts.join('/'))}${fragment ? `#${fragment}` : ''}`;
}

const KEY_NAMES = {
  'arrow-up': 'Up',
  'arrow-down': 'Down',
  'arrow-left': 'Left',
  'arrow-right': 'Right',
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
  cmd: 'Cmd',
  enter: 'Enter',
  space: 'Space',
  esc: 'Esc',
  tab: 'Tab',
  del: 'Del',
  backspace: 'Backspace',
};

/** `++ctrl+k++` -> <kbd>Ctrl</kbd>+<kbd>K</kbd>. */
function keys(line) {
  return line.replace(/\+\+([a-z0-9-]+(?:\+[a-z0-9-]+)*)\+\+/g, (_, combo) =>
    combo
      .split('+')
      .map((key) => `<kbd>${KEY_NAMES[key] ?? key.toUpperCase()}</kbd>`)
      .join('+'),
  );
}

const dedent = (line) => (line.startsWith('    ') ? line.slice(4) : line.trimStart());

/**
 * One page: the MkDocs syntax replaced, the links rewritten, a line at the top saying where the
 * page comes from. `read(path)` returns a repo file for the `--8<--` snippet lines.
 */
export function convertPage(docPath, text, read) {
  const out = [];
  const lines = text.split(/\r?\n/);
  let i = 0;
  let inFence = false;
  const indentedBlock = () => {
    // The body of a tab or admonition: blank lines and lines indented by four, until the first
    // line that is neither (the body may contain fenced code, indented along with it).
    const body = [];
    while (i < lines.length && (lines[i].trim() === '' || lines[i].startsWith('    '))) {
      body.push(lines[i]);
      i += 1;
    }
    while (body.length > 0 && body[body.length - 1].trim() === '') body.pop();
    return body.map(dedent);
  };
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^(\s*)```(\w*)(.*)$/.exec(line);
    if (fence) {
      inFence = !inFence;
      const title = /title="([^"]*)"/.exec(fence[3]);
      if (inFence && title) {
        out.push(`${fence[1]}**${title[1]}**`, '');
        out.push(`${fence[1]}\`\`\`${fence[2]}`);
      } else {
        out.push(line);
      }
      i += 1;
      continue;
    }
    const snippet = /^(\s*)--8<-- "([^"]+)"\s*$/.exec(line);
    if (snippet) {
      const content = read(snippet[2]).replace(/\r?\n$/, '');
      out.push(...content.split('\n').map((each) => (each ? `${snippet[1]}${each}` : each)));
      i += 1;
      continue;
    }
    if (inFence) {
      out.push(line);
      i += 1;
      continue;
    }
    const tab = /^=== "([^"]+)"\s*$/.exec(line);
    if (tab) {
      i += 1;
      out.push(
        `**${tab[1]}**`,
        '',
        ...convertPage(docPath, indentedBlock().join('\n'), read).trimEnd().split('\n'),
        '',
      );
      continue;
    }
    const admonition = /^(?:!!!|\?\?\?\+?) (\w+)(?: "([^"]*)")?\s*$/.exec(line);
    if (admonition) {
      i += 1;
      const kind = ALERTS[admonition[1]] ?? 'note';
      const body = convertPage(docPath, indentedBlock().join('\n'), read).trimEnd().split('\n');
      out.push(`> [!${kind}]${admonition[2] ? ` **${admonition[2]}**` : ''}`);
      out.push(...body.map((each) => (each ? `> ${each}` : '>')), '');
      continue;
    }
    out.push(
      keys(line).replace(/\]\(([^)\s]+)\)/g, (whole, target) => {
        const rewritten = rewriteLink(target, docPath);
        return rewritten === target ? whole : `](${rewritten})`;
      }),
    );
    i += 1;
  }
  return (
    out
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n'
  );
}

/** The note at the top of every mirrored page. */
export function banner(docPath) {
  return (
    `> This page is a copy of [\`${docPath}\`](${SOURCE}${docPath}) in the repository, refreshed by CI ` +
    `on every merge. Edit it there. The rendered site: ${sitePath(docPath)}\n\n`
  );
}

/**
 * Every wiki page from the docs: `docs` maps doc paths (`docs/index.md`) to their text, `mkdocs`
 * is mkdocs.yml, `read` fetches a repo file for snippets. Returns wiki path -> page markdown.
 */
export function wikiPages({ docs, mkdocs, read }) {
  const pages = new Map();
  for (const [docPath, text] of [...docs.entries()].sort()) {
    pages.set(wikiPath(docPath), banner(docPath) + convertPage(docPath, text, read));
  }
  pages.set('_sidebar', sidebar(parseNav(mkdocs)));
  return pages;
}
