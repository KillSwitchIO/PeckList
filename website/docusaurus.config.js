// The documentation site (docs/ at the repository root), built by CI and published to GitLab Pages
// from main as docs.pecklist.com. Locally: pnpm --filter @pecklist/docs start (or build).
import { fileURLToPath } from 'node:url';
import { themes } from 'prism-react-renderer';
import snippets from './src/remark/snippets.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const repo = 'https://gitlab.com/killswitch10/pecklist';
// Visit counts: Umami at stats.pecklist.com (website "docs.pecklist.com"); only the scripts and the
// report endpoints are public there.
const umami = '6c0a1406-9f89-4d9d-8672-5bf0c13ed894';

/** @type {import('@docusaurus/types').Config} */
export default {
  title: 'PeckList',
  tagline: 'Self-hosted, offline-first tasks and calendar',
  favicon: 'img/favicon.svg',
  url: 'https://docs.pecklist.com',
  baseUrl: '/',
  // The pages keep the addresses they had (install/docker/ and so on).
  trailingSlash: true,
  // Broken links and #anchors fail the build.
  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  markdown: {
    hooks: { onBrokenMarkdownLinks: 'throw', onBrokenMarkdownImages: 'throw' },
  },
  i18n: { defaultLocale: 'en', locales: ['en'] },
  scripts: [
    { src: 'https://stats.pecklist.com/script.js', defer: true, 'data-website-id': umami },
    { src: 'https://stats.pecklist.com/recorder.js', defer: true, 'data-website-id': umami },
  ],
  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          path: '../docs',
          routeBasePath: '/',
          // The sections and their order; the wiki mirror reads it too (scripts/wiki-pages.mjs).
          sidebarPath: './sidebars.json',
          // The newest release's docs at the root; main's under /next/, and every release since
          // 0.6.0 in the version menu (website/versioned_docs, made by `pnpm release`).
          versions: { current: { label: 'Next (main)', path: 'next', banner: 'unreleased' } },
          // Only main's pages are edited; a release's copy stays as it shipped.
          editUrl: ({ version, docPath }) =>
            version === 'current' ? `${repo}/-/edit/main/docs/${docPath}` : undefined,
          remarkPlugins: [[snippets, { root }]],
        },
        blog: false,
        pages: false,
        theme: { customCss: './src/css/custom.css' },
      }),
    ],
  ],
  themes: [
    [
      '@easyops-cn/docusaurus-search-local',
      /** @type {import('@easyops-cn/docusaurus-search-local').PluginOptions} */
      ({ hashed: true, docsRouteBasePath: '/', indexBlog: false, indexPages: false }),
    ],
  ],
  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      colorMode: { respectPrefersColorScheme: true },
      navbar: {
        title: 'PeckList',
        logo: { alt: '', src: 'img/icon.svg' },
        items: [
          { type: 'docsVersionDropdown', position: 'right' },
          {
            href: 'https://pecklist.com/support/',
            label: 'Support',
            position: 'right',
            className: 'navbar-support',
          },
          { href: 'https://pecklist.com', label: 'pecklist.com', position: 'right' },
          { href: repo, label: 'GitLab', position: 'right' },
        ],
      },
      footer: {
        style: 'dark',
        copyright: `PeckList is free software under the AGPL-3.0-or-later. Source on <a href="${repo}">GitLab</a>.`,
      },
      prism: {
        theme: themes.github,
        darkTheme: themes.dracula,
        additionalLanguages: [
          'bash',
          'powershell',
          'nginx',
          'apacheconf',
          'ini',
          'docker',
          'csharp',
          'json',
          'yaml',
          'toml',
          'diff',
        ],
      },
    }),
};
