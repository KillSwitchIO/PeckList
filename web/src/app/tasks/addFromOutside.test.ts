import { afterEach, describe, expect, it } from 'vitest';
import { addedFromOutside, forgetAddFromOutside, noteAddFromOutside } from './addFromOutside.ts';

afterEach(() => {
  forgetAddFromOutside();
  window.history.replaceState(null, '', '/');
});

describe('addedFromOutside', () => {
  it('is false for a plain start', () => {
    window.history.replaceState(null, '', '/today');
    expect(addedFromOutside()).toBe(false);
  });

  it('is true while the address still has ?add=1, before the app frame has noted it', () => {
    window.history.replaceState(null, '', '/today?add=1');
    expect(addedFromOutside()).toBe(true);
  });

  it('stays true once noted, after the address has lost ?add=1', () => {
    noteAddFromOutside();
    window.history.replaceState(null, '', '/today');
    expect(addedFromOutside()).toBe(true);
  });
});
