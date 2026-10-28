import { describe, expect, it } from 'vitest';
import {
  burst,
  EGGS,
  eggFor,
  isPinataTitle,
  isQuack,
  isTypewriterTitle,
  KONAMI,
  konamiTracker,
  seasonOf,
} from './eggs.ts';

describe('easter eggs (R-FB-122)', () => {
  it('lists fifteen, each with its own trigger', () => {
    expect(EGGS).toHaveLength(15);
    expect(new Set(EGGS.map((each) => each.egg)).size).toBe(15);
  });

  it('hides surprises behind a few search words, however they are typed', () => {
    expect(eggFor('Party   Time ')).toBe('confetti');
    expect(eggFor('do a barrel roll')).toBe('roll');
    expect(eggFor('Insert Coin')).toBe('retro');
    expect(eggFor('follow the white rabbit')).toBe('matrix');
    expect(eggFor('party')).toBeNull();
  });

  it('knows its titles and comments', () => {
    expect(isPinataTitle('Fill the Piñata')).toBe(true);
    expect(isPinataTitle('buy pinata candy')).toBe(true);
    expect(isTypewriterTitle(' Clickety  clack ')).toBe(true);
    expect(isQuack('Quack!')).toBe(true);
    expect(isQuack('quack quack')).toBe(false);
  });

  it('knows the Konami code, even after a wrong key', () => {
    const konami = konamiTracker();
    expect(['ArrowUp', 'x', ...KONAMI.slice(0, -1)].map(konami).some(Boolean)).toBe(false);
    expect(konami('A')).toBe(true);
    expect(konami('a')).toBe(false);
  });

  it('counts quick runs: the third within the time, not a slow one', () => {
    expect(burst('test', 3, 1000, 0)).toBe(false);
    expect(burst('test', 3, 1000, 500)).toBe(false);
    expect(burst('test', 3, 1000, 2000)).toBe(false);
    expect(burst('test', 3, 1000, 2100)).toBe(false);
    expect(burst('test', 3, 1000, 2200)).toBe(true);
  });

  it('lets each season fall', () => {
    expect(seasonOf(1).name).toBe('winter');
    expect(seasonOf(4).name).toBe('spring');
    expect(seasonOf(7).name).toBe('summer');
    expect(seasonOf(10).pieces).toContain('🍂');
  });
});
