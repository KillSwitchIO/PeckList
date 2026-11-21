import { describe, expect, it } from 'vitest';
import { stemOf } from './attachments.ts';

// A file's rename selects the name before its extension (PL-051), so typing keeps the extension.
describe('the name before a file extension', () => {
  it('stops at the last dot', () => {
    expect(stemOf('quote.pdf')).toEqual([0, 5]);
    expect(stemOf('backup.tar.gz')).toEqual([0, 10]);
  });

  it('is the whole name with no extension, or only a leading dot', () => {
    expect(stemOf('README')).toEqual([0, 6]);
    expect(stemOf('.env')).toEqual([0, 4]);
    expect(stemOf('')).toEqual([0, 0]);
  });
});
