import { describe, expect, it } from 'vitest';
import { clampPlacement, cropSquare, startPlacement, zoomAbout } from './photoCrop.ts';

// A landscape photo 400 x 200 in a circle 100 across.
const W = 400;
const H = 200;
const D = 100;

describe('fitting a photo in its circle', () => {
  it('starts filling the circle, centered, showing the middle of the photo', () => {
    const start = startPlacement(W, H, D);
    expect(start).toEqual({ scale: 0.5, x: 0, y: 0 });
    expect(cropSquare(start, W, H, D)).toEqual({ x: 100, y: 0, size: 200 });
  });

  it('never shows past the photo’s edge, and never shrinks it below the circle', () => {
    expect(clampPlacement({ scale: 0.5, x: 500, y: 40 }, W, H, D)).toEqual({
      scale: 0.5,
      x: 50,
      y: 0,
    });
    expect(clampPlacement({ scale: 0.1, x: 0, y: 0 }, W, H, D).scale).toBe(0.5);
    expect(clampPlacement({ scale: 99, x: 0, y: 0 }, W, H, D).scale).toBe(3);
  });

  it('moved fully left, the circle shows the photo’s left edge', () => {
    const placed = clampPlacement({ scale: 0.5, x: 999, y: 0 }, W, H, D);
    expect(cropSquare(placed, W, H, D)).toEqual({ x: 0, y: 0, size: 200 });
  });

  it('zooming keeps the point under the fingers still', () => {
    const start = startPlacement(W, H, D);
    const zoomed = zoomAbout(start, 1, 20, 10, W, H, D);
    expect(zoomed.scale).toBe(1);
    // The image point that was under (20, 10) is still there.
    const before = { x: (20 - start.x) / start.scale, y: (10 - start.y) / start.scale };
    const after = { x: (20 - zoomed.x) / zoomed.scale, y: (10 - zoomed.y) / zoomed.scale };
    expect(after).toEqual(before);
  });
});
