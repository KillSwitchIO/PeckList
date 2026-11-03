/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };
import { serverPathPatterns } from './src/serverPaths.ts';
import { workspaceValidator } from './workspace-validator.ts';
import { precompress } from './precompress.ts';

// The version the app shows under its menu: what a release or CI build stamps (the Dockerfile's
// VERSION), else package.json's. A plain dev stamp falls back too.
const stamped = process.env.PUNCHLIST_VERSION;
const version = stamped && !stamped.startsWith('0.0.0') ? stamped : pkg.version;
const revision = (process.env.PUNCHLIST_REVISION ?? '').slice(0, 7);

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_REVISION__: JSON.stringify(/^[0-9a-f]{7}$/.test(revision) ? revision : ''),
  },
  // Vite's default 5173 often falls inside a port range Windows reserves for Hyper-V/WSL.
  server: {
    port: 6173,
    strictPort: true,
    // Native file events on Windows miss edits (branch switches, scripted edits, the pre-commit
    // hook rewriting files), leaving the browser on stale modules. Polling is reliable there.
    ...(process.platform === 'win32' ? { watch: { usePolling: true, interval: 300 } } : {}),
    // `PUNCHLIST_SERVER=http://localhost:5000 pnpm dev` talks to a running server; without it the
    // app runs standalone, as a static PWA does.
    ...(process.env.PUNCHLIST_SERVER
      ? {
          proxy: {
            '/api': { target: process.env.PUNCHLIST_SERVER, changeOrigin: true },
            '/auth': { target: process.env.PUNCHLIST_SERVER, changeOrigin: true },
          },
        }
      : {}),
  },
  // An IPv4 address, not `localhost`: in a container `localhost` may be IPv6 for one side and
  // IPv4 for the other, and the e2e run then never finds the server.
  preview: { host: '127.0.0.1', port: 6174, strictPort: true },
  plugins: [
    react(),
    workspaceValidator(fileURLToPath(new URL('../schema/workspace.schema.json', import.meta.url))),
    VitePWA({
      registerType: 'prompt',
      includeAssets: [
        'icon.svg',
        'favicon.svg',
        'icons/icon-180.png',
        'icons/icon-192.png',
        'icons/icon-512.png',
      ],
      workbox: {
        // Page loads of the server's own paths go to the network, never the app shell: signing in
        // with a provider and its return to the callback are page loads (src/serverPaths.ts).
        navigateFallbackDenylist: serverPathPatterns,
        // Reminders: a click on a notification opens its task (public/sw-notifications.js).
        importScripts: ['sw-notifications.js'],
      },
      manifest: {
        name: 'PeckList',
        short_name: 'PeckList',
        description: 'Tasks and calendar, offline-first',
        theme_color: '#4F8F87',
        background_color: '#FAFAF7',
        display: 'standalone',
        // The SVG for browsers that take it; PNGs (public/icons, rendered from icon.svg) for
        // those that want a bitmap at a set size.
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      },
    }),
    precompress(),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // UI tests type and click through whole flows in jsdom; under coverage on a busy machine the
    // longer ones pass 5 s now and then, which failed pushes at random. CI's runner is shared and
    // slower again (a settings flow took 15 s there; with other jobs on the same runner, 30 s).
    testTimeout: process.env.CI ? 45_000 : 15_000,
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/main.tsx', 'src/**/*.d.ts'],
      reporter: ['text-summary', 'html', 'cobertura', 'json-summary'],
      // A safety net against untested new code, not a target. Behavior tests (fixtures,
      // contract suites, E2E flows) are what catch unintended changes. See CONTRIBUTING.md.
      thresholds: {
        'src/core/**': { lines: 80, branches: 70 },
        'src/adapters/**': { lines: 70, branches: 60 },
        'src/app/**': { lines: 60, branches: 50 },
      },
    },
  },
});
