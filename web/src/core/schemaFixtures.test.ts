// The standalone fixtures in schema/fixtures/workspace: what a valid document looks like, the
// smallest and one with every collection and optional field, and documents that must be refused.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAjvValidator } from '../adapters/ajv-validator.ts';
import { openDocument } from './io.ts';
import { COLLECTIONS } from './types.ts';

// Tests run from web/.
const DIR = resolve(process.cwd(), '../schema/fixtures/workspace');
const read = (name: string) => JSON.parse(readFileSync(join(DIR, name), 'utf8')) as unknown;
const validator = createAjvValidator();

describe('workspace fixtures', () => {
  it('opens the minimal and the full document', () => {
    expect(openDocument(read('minimal.json'), validator).kind).toBe('ok');
    const full = openDocument(read('full.json'), validator);
    expect(full.kind).toBe('ok');
    if (full.kind !== 'ok') return;
    // Every collection has something in it, so the schema is exercised for each.
    const empty = COLLECTIONS.filter(
      (collection) => full.workspace.entities[collection].length === 0,
    );
    expect(empty).toEqual([]);
  });

  const invalid = readdirSync(join(DIR, 'invalid')).filter((name) => name.endsWith('.json'));

  it.each(invalid)('refuses invalid/%s', (name) => {
    const result = openDocument(read(`invalid/${name}`), validator);
    expect(result.kind).toBe('invalid');
  });

  it('has invalid cases to check', () => {
    expect(invalid.length).toBeGreaterThanOrEqual(6);
  });
});
