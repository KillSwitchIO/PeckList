import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import standalone from 'ajv/dist/standalone/index.js';
import type { Plugin } from 'vite';

const id = 'virtual:workspace-validator';
const resolved = `\0${id}`;

/**
 * `virtual:workspace-validator`: the workspace schema's validator, compiled at build time.
 * Compiling it in the browser (`ajv.compile`) builds code with `new Function`, which a
 * Content-Security-Policy without 'unsafe-eval' refuses. Built from the schema on every build,
 * so the two cannot drift apart.
 */
export function workspaceValidator(schemaPath: string): Plugin {
  return {
    name: 'pecklist-workspace-validator',
    resolveId: (source) => (source === id ? resolved : undefined),
    load(loading) {
      if (loading !== resolved) return undefined;
      this.addWatchFile(schemaPath);
      const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as object;
      const ajv = new Ajv2020({ allErrors: true, strict: true, code: { source: true, esm: true } });
      return standalone(ajv, ajv.compile(schema));
    },
  };
}
