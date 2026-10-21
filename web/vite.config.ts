/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Vite's default 5173 often falls inside a port range Windows reserves for Hyper-V/WSL.
  server: { port: 6173, strictPort: true },
  preview: { port: 6174, strictPort: true },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Punchlist',
        short_name: 'Punchlist',
        description: 'Tasks and calendar, offline-first',
        theme_color: '#4F8F87',
        background_color: '#FAFAF7',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
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
