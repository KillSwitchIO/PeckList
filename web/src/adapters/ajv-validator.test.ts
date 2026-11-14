// The validator is compiled at build time (workspace-validator.ts), so the app runs under a
// Content-Security-Policy without 'unsafe-eval'. It must judge documents exactly as compiling the
// schema in the browser did.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAjvValidator } from './ajv-validator.ts';

// Tests run from web/.
const SCHEMA = resolve(process.cwd(), '../schema');
const FIXTURES = join(SCHEMA, 'fixtures/workspace');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as unknown;
const documents = [
  'minimal.json',
  'full.json',
  ...readdirSync(join(FIXTURES, 'invalid'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => `invalid/${name}`),
];

describe('the build-time validator', () => {
  const atRunTime = new Ajv2020({ allErrors: true, strict: true }).compile(
    read(join(SCHEMA, 'workspace.schema.json')) as object,
  );

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(documents)('judges %s as compiling at run time does', (name) => {
    const document = read(join(FIXTURES, name));
    const result = createAjvValidator().validate(document);
    expect(result.valid).toBe(atRunTime(document));
    expect(result.errors).toEqual(
      (atRunTime.errors ?? []).map(
        (error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`,
      ),
    );
  });

  // maxLength counts characters with a helper the compiled code imports (asImports in
  // workspace-validator.ts). If a later Ajv or Vite turned that import into the module object,
  // every person with a photo would throw here instead of being judged.
  it('refuses a photo over 80,000 characters with a length error, and keeps one under it', () => {
    const document = read(join(FIXTURES, 'full.json')) as {
      entities: { users: { photo: string }[] };
    };
    const person = document.entities.users[0];
    if (!person) throw new Error('full.json has no person');
    const head = 'data:image/png;base64,';
    person.photo = head + 'A'.repeat(80_001 - head.length);
    const tooLong = createAjvValidator().validate(document);
    expect(tooLong.valid).toBe(false);
    expect(tooLong.errors).toContain(
      '/entities/users/0/photo must NOT have more than 80000 characters',
    );

    person.photo = head + 'A'.repeat(80_000 - head.length);
    expect(createAjvValidator().validate(document)).toEqual({ valid: true, errors: [] });
  });

  it('builds no code, so it needs no unsafe-eval', () => {
    const built = vi.spyOn(globalThis, 'Function');
    createAjvValidator().validate(read(join(FIXTURES, 'full.json')));
    expect(built).not.toHaveBeenCalled();
  });
});
