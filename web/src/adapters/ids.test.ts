import { describe, expect, it } from 'vitest';
import { createUlidGenerator } from './ulid-ids.ts';

describe('ULID generator', () => {
  it('produces valid, unique, increasing ids', () => {
    const ids = createUlidGenerator();
    const values = Array.from({ length: 500 }, () => ids.next());
    for (const value of values) expect(value).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(new Set(values).size).toBe(values.length);
    expect([...values].sort()).toEqual(values);
  });
});
