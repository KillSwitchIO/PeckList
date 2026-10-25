// The sums behind fitting a photo into its circle (spec: R-FB-57): how far it may be scaled and
// moved so the circle stays covered, and which square of the image ends up inside it.

export interface Placement {
  /** Screen pixels per image pixel */
  scale: number;
  /** Where the image's middle sits from the circle's middle, in screen pixels */
  x: number;
  y: number;
}

/** The smallest scale that still fills a circle `diameter` across, and the largest allowed. */
export function scaleRange(width: number, height: number, diameter: number) {
  const least = diameter / Math.min(width, height);
  return { least, most: least * 6 };
}

/** Keep the scale in range and the circle covered: the image may not slide past its edge. */
export function clampPlacement(
  placement: Placement,
  width: number,
  height: number,
  diameter: number,
): Placement {
  const { least, most } = scaleRange(width, height, diameter);
  const scale = Math.min(most, Math.max(least, placement.scale));
  const roomX = Math.max(0, (width * scale - diameter) / 2);
  const roomY = Math.max(0, (height * scale - diameter) / 2);
  return {
    scale,
    x: Math.min(roomX, Math.max(-roomX, placement.x)),
    y: Math.min(roomY, Math.max(-roomY, placement.y)),
  };
}

/** The image is first shown filling the circle, centered. */
export function startPlacement(width: number, height: number, diameter: number): Placement {
  return { scale: scaleRange(width, height, diameter).least, x: 0, y: 0 };
}

/** Zoom to `scale` about a point (`px`, `py` from the circle's middle), keeping that point still. */
export function zoomAbout(
  placement: Placement,
  scale: number,
  px: number,
  py: number,
  width: number,
  height: number,
  diameter: number,
): Placement {
  const ratio = scale / placement.scale;
  return clampPlacement(
    {
      scale,
      x: px - (px - placement.x) * ratio,
      y: py - (py - placement.y) * ratio,
    },
    width,
    height,
    diameter,
  );
}

/** The square of the image (in image pixels) that shows inside the circle. */
export function cropSquare(placement: Placement, width: number, height: number, diameter: number) {
  const size = diameter / placement.scale;
  const centerX = width / 2 - placement.x / placement.scale;
  const centerY = height / 2 - placement.y / placement.scale;
  return { x: centerX - size / 2, y: centerY - size / 2, size };
}
