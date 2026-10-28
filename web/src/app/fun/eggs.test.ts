import { describe, expect, it } from 'vitest';
import { eggFor, KONAMI, konamiTracker } from './eggs.ts';

describe('easter eggs (R-FB-122)', () => {
  it('hides surprises behind a few search words, however they are typed', () => {
    expect(eggFor('Party   Time ')).toBe('confetti');
    expect(eggFor('do a barrel roll')).toBe('roll');
    expect(eggFor('party')).toBeNull();
  });

  it('knows the Konami code, even after a wrong key', () => {
    const konami = konamiTracker();
    expect(['ArrowUp', 'x', ...KONAMI.slice(0, -1)].map(konami).some(Boolean)).toBe(false);
    expect(konami('A')).toBe(true);
    expect(konami('a')).toBe(false);
  });
});
