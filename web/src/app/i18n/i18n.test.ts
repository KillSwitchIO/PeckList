import { describe, expect, it } from 'vitest';
import { t, type MessageKey } from './i18n.ts';

describe('t', () => {
  it('fills parameters', () => {
    expect(t('tag.preview', { path: 'home/yard' })).toBe('Will be saved as home/yard');
  });

  it('falls back to the key instead of crashing on a missing string', () => {
    expect(t('missing.key' as MessageKey)).toBe('missing.key');
  });
});
