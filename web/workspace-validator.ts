import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import standalone from 'ajv/dist/standalone/index.js';
import type { Plugin } from 'vite';

const id = 'virtual:workspace-validator';
const resolved = `\0${id}`;

/**
 * Ajv's ES module output still asks for its runtime helpers with `require(...).default` (the
 * string-length one, for maxLength). A production build turns that into an import, but the dev
 * server and Vitest's browser mode do not, and the module fails with "require is not defined".
 * So each becomes an import here; the helpers mark themselves as ES modules, so the default
 * import is their `default`.
 */
export function asImports(code: string): string {
  const helpers: string[] = [];
  const body = code.replace(/require\("(ajv\/dist\/runtime\/[\w-]+)"\)\.default/g, (_, path) => {
    const index = helpers.indexOf(path as string);
    if (index >= 0) return `ajvRuntime${index}`;
    helpers.push(path as string);
    return `ajvRuntime${helpers.length - 1}`;
  });
  const imports = helpers.map((path, index) => `import ajvRuntime${index} from "${path}.js";`);
  return [...imports, body].join('\n');
}

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
      return asImports(standalone(ajv, ajv.compile(schema)));
    },
  };
}
