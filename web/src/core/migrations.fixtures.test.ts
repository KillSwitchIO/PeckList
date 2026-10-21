// Every schema migration against its kept fixtures (schema/fixtures/migrations).
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAjvValidator } from '../adapters/ajv-validator.ts';
import { CURRENT_SCHEMA_VERSION, migrate } from './migrations.ts';

// Tests run from web/.
const DIR = resolve(process.cwd(), '../schema/fixtures/migrations');
const read = (name: string) =>
  JSON.parse(readFileSync(join(DIR, name), 'utf8')) as Record<string, unknown>;

describe('migration fixtures', () => {
  const versions = readdirSync(DIR)
    .map((name) => /^(\d+)-input\.json$/.exec(name)?.[1])
    .filter((version): version is string => version !== undefined)
    .map(Number);

  it('has fixtures for every version after 1', () => {
    expect(versions.sort((a, b) => a - b)).toEqual(
      Array.from({ length: CURRENT_SCHEMA_VERSION - 1 }, (_, i) => i + 2),
    );
  });

  it.each(versions)('migrates the version %i fixture as expected', (version) => {
    const expected = read(`${version}-expected.json`);
    expect(migrate(read(`${version}-input.json`), version)).toEqual(expected);
  });

  it('the current version fixture is a valid workspace', () => {
    const result = createAjvValidator().validate(read(`${CURRENT_SCHEMA_VERSION}-expected.json`));
    expect(result.errors).toEqual([]);
  });
});
