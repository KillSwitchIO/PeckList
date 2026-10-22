import { describe, expect, it } from 'vitest';
import { encodeQr } from './qrcode-generator.ts';

describe('QR encoder', () => {
  it('makes a square code with the three finder patterns', () => {
    const modules = encodeQr('https://punchlist.example/f/7QM4-K2XP');
    const size = modules.length;
    // Versions run 21, 25, 29 ... modules wide.
    expect((size - 21) % 4).toBe(0);
    expect(modules.every((row) => row.length === size)).toBe(true);
    // Each finder is a 7x7 dark ring around a light ring around a dark 3x3 centre.
    for (const [top, left] of [
      [0, 0],
      [0, size - 7],
      [size - 7, 0],
    ] as const) {
      expect(modules[top]!.slice(left, left + 7)).toEqual(Array(7).fill(true));
      expect(modules[top + 1]![left + 1]).toBe(false);
      expect(modules[top + 3]![left + 3]).toBe(true);
    }
  });

  it('longer text needs a bigger code', () => {
    expect(encodeQr('x'.repeat(200)).length).toBeGreaterThan(encodeQr('x').length);
  });
});
