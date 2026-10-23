import { describe, expect, it } from 'vitest';
import { initialsOf } from './Avatar.tsx';

describe('initialsOf', () => {
  it('takes the first letters of the first and last names', () => {
    expect(initialsOf('Ben Dimit')).toBe('BD');
    expect(initialsOf('Mary Ann de Vries')).toBe('MV');
    expect(initialsOf('kim.lee')).toBe('KL');
    expect(initialsOf('ben')).toBe('B');
    expect(initialsOf('  ')).toBe('?');
    expect(initialsOf('Émile Zola')).toBe('ÉZ');
  });
});
