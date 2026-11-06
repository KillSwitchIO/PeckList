import { describe, expect, it } from 'vitest';
import { mayCleanUp } from './syncContext.ts';

describe('mayCleanUp', () => {
  it('waits until a device with a server has heard from it', () => {
    expect(mayCleanUp({ phase: 'checking', lastSynced: null })).toBe(false);
    expect(mayCleanUp({ phase: 'ready', lastSynced: null })).toBe(false);
    expect(mayCleanUp({ phase: 'signed-out', lastSynced: null })).toBe(false);
    expect(mayCleanUp({ phase: 'ready', lastSynced: 1 })).toBe(true);
  });

  it('does not wait on a device with no server', () => {
    expect(mayCleanUp({ phase: 'standalone', lastSynced: null })).toBe(true);
  });
});
