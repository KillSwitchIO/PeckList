import { describe, expect, it } from 'vitest';
import { isNewer, pageStatus, releaseOf, withoutBuild } from './versions.ts';

describe('versions', () => {
  it('reads releases out of tags and edge builds', () => {
    expect(withoutBuild('v0.2.7+20261028')).toBe('0.2.7');
    expect(releaseOf('0.2.8-edge.1a2b3c4d')).toEqual([0, 2, 8]);
    expect(releaseOf('nightly')).toBeNull();
  });

  it('compares by number, not text, and an edge build is not behind its release', () => {
    expect(isNewer('0.10.0', '0.9.9')).toBe(true);
    expect(isNewer('v0.2.7+20261028', '0.2.7-edge.d89f0541')).toBe(false);
    expect(isNewer('0.2.7', '0.2.6')).toBe(true);
    expect(isNewer(null, '0.2.6')).toBe(false);
  });

  it('a page is the same as its server only on the same build', () => {
    expect(pageStatus('0.2.7', '0.2.7')).toBe('same');
    expect(pageStatus('0.2.6', '0.2.7')).toBe('different');
    expect(pageStatus('0.2.8-edge.1', '0.2.8-edge.2')).toBe('different');
  });
});
