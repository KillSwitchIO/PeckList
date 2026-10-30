// End-to-end tests that need a running Punchlist server (sync between devices). Point
// E2E_BASE_URL at one started with ADMIN_PASSWORD=$E2E_ADMIN_PASSWORD, e.g.:
//   docker run -d -p 6183:8080 -e ADMIN_PASSWORD=e2e-admin-password -e TELEMETRY=false punchlist:dev
//   E2E_BASE_URL=http://localhost:6183 E2E_ADMIN_PASSWORD=e2e-admin-password pnpm e2e:server
import { config as base } from './wdio.conf.ts';

if (!process.env.E2E_BASE_URL) throw new Error('set E2E_BASE_URL to a running Punchlist server');
if (!process.env.E2E_ADMIN_PASSWORD)
  throw new Error('set E2E_ADMIN_PASSWORD to its ADMIN_PASSWORD');

export const config: WebdriverIO.Config = {
  ...base,
  specs: ['./server-specs/**/*.e2e.ts'],
  // The specs share one server's data: one browser at a time.
  maxInstances: 1,
  mochaOpts: { ui: 'bdd', timeout: 120_000 },
};
