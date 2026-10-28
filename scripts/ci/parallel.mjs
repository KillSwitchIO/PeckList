// Run shell commands at the same time; exit non-zero if any fails, printing each one's output as
// it finishes. For CI jobs made of independent steps (lint, format, typecheck).
//   node scripts/ci/parallel.mjs "pnpm lint" "pnpm format:check" "pnpm typecheck"

import { exec } from 'node:child_process';

const commands = process.argv.slice(2);
if (commands.length === 0) {
  console.error('Usage: node scripts/ci/parallel.mjs "<command>" ...');
  process.exit(2);
}

const run = (command) =>
  new Promise((resolve) => {
    const started = Date.now();
    exec(command, { env: process.env, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`\n=== ${command} (${error ? 'FAILED' : 'ok'}, ${seconds}s)\n${stdout}${stderr}`);
      resolve(error ? 1 : 0);
    });
  });

const results = await Promise.all(commands.map(run));
process.exit(results.some((code) => code !== 0) ? 1 : 0);
