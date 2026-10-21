import { describe, expect, it } from 'vitest';
import { pillsThatFit } from './pillsFit.ts';

describe('tag pills in the bottom bar', () => {
  it('shows as many as fit, keeping room for + and "+N"', () => {
    // Pills of 40px with 6px gaps; the + takes 22px and "+N" 30px more.
    expect(pillsThatFit([40, 40, 40], 1000)).toBe(3);
    expect(pillsThatFit([40, 40, 40], 3 * 46 + 22)).toBe(3);
    expect(pillsThatFit([40, 40, 40], 3 * 46 + 21)).toBe(2);
    expect(pillsThatFit([40, 40, 40], 46 + 22 + 36)).toBe(1);
    expect(pillsThatFit([40, 40, 40], 10)).toBe(0);
  });
});
