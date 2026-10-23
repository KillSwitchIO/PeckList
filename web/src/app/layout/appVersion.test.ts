import { describe, expect, it } from 'vitest';
import { versionLabel } from './appVersion.ts';

describe('versionLabel', () => {
  it('names the commit only when the version does not', () => {
    expect(versionLabel('0.2.0', '')).toBe('v0.2.0');
    expect(versionLabel('0.2.0', 'abc1234')).toBe('v0.2.0 (abc1234)');
    expect(versionLabel('0.1.0-dev.abc1234', 'abc1234')).toBe('v0.1.0-dev.abc1234');
  });
});
