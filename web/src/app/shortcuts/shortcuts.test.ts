import { describe, expect, it } from 'vitest';
import { matchShortcut, SHORTCUTS } from './shortcuts.ts';

describe('shortcut registry', () => {
  it('matches single keys and G sequences', () => {
    expect(matchShortcut(['q'])).toMatchObject({ action: { kind: 'addTask' } });
    expect(matchShortcut(['g'])).toBe('pending');
    expect(matchShortcut(['g', 't'])).toMatchObject({ action: { kind: 'go', path: '/today' } });
    expect(matchShortcut(['g', 'z'])).toBeNull();
    expect(matchShortcut(['x'])).toBeNull();
  });

  it('never uses one key sequence twice', () => {
    const keys = SHORTCUTS.map((each) => each.keys.join('+'));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
