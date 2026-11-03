// The docs (docs/, the Docusaurus site in website/) as GitLab wiki pages: the same pages, with the
// site-only syntax turned into what GitLab renders (alerts for admonitions, bold headings for tabs,
// the example files pasted in place of snippet lines) and the links pointed at wiki pages. The
// rendered site stays the home of the docs; the wiki is a mirror of main's docs that CI refreshes
// on every merge (scripts/ci/wiki-sync.mjs, docs/development/ci.md).
//
// Pure: takes the files, returns the pages. The git work is in scripts/ci/wiki-sync.mjs.

// main's docs are the site's "Next" version; the root shows the newest release.
const SITE = 'https://docs.pecklist.com/next/';
const SOURCE = 'https://gitlab.com/killswitch10/pecklist/-/blob/main/';
const RAW = 'https://gitlab.com/killswitch10/pecklist/-/raw/main/';
const IMAGE = /\.(png|jpe?g|gif|svg|webp)$/i;

/** Admonition kinds GitLab shows as alerts; anything else becomes a note. */
const ALERTS = {
  note: 'note',
  tip: 'tip',
  info: 'note',
  warning: 'warning',
  danger: 'caution',
  important: 'important',
};

/** `docs/install/docker.md` -> `install/docker`; a section's `index.md` is the section's page. */
export function wikiPath(docPath) {
  const path = docPath.replace(/^docs\//, '').replace(/\.mdx?$/, '');
  if (path === 'index') return 'home';
  return path.replace(/\/index$/, '');
}

/** The rendered site's address of a doc page. */
export function sitePath(docPath) {
  const path = wikiPath(docPath);
  return path === 'home' ? SITE : `${SITE}${path}/`;
}

/**
 * The site's sidebar (website/sidebars.json, `docs`) as a tree: { title, path } leaves,
 * { title, children } sections. Doc ids are paths under docs/ without `.md`.
 */
export function parseSidebar(items) {
  return items.map((item) =>
    item.type === 'category'
      ? { title: item.label, children: parseSidebar(item.items) }
      : { title: item.label ?? item.id, path: `${item.id}.md` },
  );
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

/**
 * A doc-relative link target (`../guides/security.md#x`) as a wiki root link (`/guides/security#x`);
 * an image in the docs (`assets/shot.png`) as its file in the repository, which the wiki lacks.
 */
export function rewriteLink(target, docPath) {
  if (/^[a-z]+:/i.test(target) || target.startsWith('#') || target.startsWith('/')) return target;
  const [file, fragment] = target.split('#');
  const isImage = IMAGE.test(file);
  if (!/\.mdx?$/.test(file) && !isImage) return target;
  const parts = docPath.split('/').slice(0, -1);
  for (const piece of file.split('/')) {
    if (piece === '..') parts.pop();
    else if (piece !== '.') parts.push(piece);
  }
  if (isImage) return `${RAW}${parts.join('/')}`;
  return `/${wikiPath(parts.join('/'))}${fragment ? `#${fragment}` : ''}`;
}

const TABS = /^\s*<\/?Tabs>\s*$/;
const TAB_END = /^\s*<\/TabItem>\s*$/;
const TAB = /^\s*<TabItem\b[^>]*\blabel="([^"]+)"[^>]*>\s*$/;
const COMMENT = /^\s*\{\/\*.*\*\/\}\s*$/;
const ADMONITION = /^:::(\w+)(?:\[([^\]]*)\])?\s*$/;

/**
 * One page: the site's syntax replaced, the links rewritten. `read(path)` returns a repo file for
 * the `--8<--` snippet lines. `<details>` and `<kbd>` stay: GitLab renders them.
 */
export function convertPage(docPath, text, read) {
  const out = [];
  const lines = text.split(/\r?\n/);
  let i = 0;
  let inFence = false;
  const admonitionBody = () => {
    // Up to the closing `:::`, without the blank lines around the body.
    const body = [];
    while (i < lines.length && lines[i].trim() !== ':::') {
      body.push(lines[i]);
      i += 1;
    }
    i += 1;
    while (body.length > 0 && body[0].trim() === '') body.shift();
    while (body.length > 0 && body[body.length - 1].trim() === '') body.pop();
    return body;
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
    if (TABS.test(line) || TAB_END.test(line) || COMMENT.test(line)) {
      i += 1;
      continue;
    }
    const tab = TAB.exec(line);
    if (tab) {
      out.push(`**${tab[1]}**`, '');
      i += 1;
      continue;
    }
    const admonition = ADMONITION.exec(line);
    if (admonition) {
      i += 1;
      const kind = ALERTS[admonition[1]] ?? 'note';
      const body = convertPage(docPath, admonitionBody().join('\n'), read).trimEnd().split('\n');
      out.push(`> [!${kind}]${admonition[2] ? ` **${admonition[2]}**` : ''}`);
      out.push(...body.map((each) => (each ? `> ${each}` : '>')), '');
      continue;
    }
    out.push(
      line.replace(/\]\(([^)\s]+)\)/g, (whole, target) => {
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
 * Every wiki page from the docs: `docs` maps doc paths (`docs/index.md`) to their text, `sidebar`
 * is the `docs` list of website/sidebars.json, `read` fetches a repo file for snippets. Returns wiki
 * path -> page markdown.
 */
export function wikiPages({ docs, sidebar: items, read }) {
  const pages = new Map();
  for (const [docPath, text] of [...docs.entries()].sort()) {
    pages.set(wikiPath(docPath), banner(docPath) + convertPage(docPath, text, read));
  }
  pages.set('_sidebar', sidebar(parseSidebar(items)));
  return pages;
}
