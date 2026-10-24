import { useState } from 'react';

const STORAGE_KEY = 'punchlist.detailWidth';

function readWidth(): number | null {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeWidth(width: number | null) {
  try {
    if (width === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(Math.round(width)));
  } catch {
    // Private mode or blocked storage: the width just isn't remembered.
  }
}

/**
 * The details panel's width as the user dragged it, remembered on this device. Null means the
 * default. `min` and `max` bound a drag; the CSS also clamps, so a narrower window still fits.
 */
export function useDetailWidth(min: number, max: () => number) {
  const [width, setWidth] = useState<number | null>(readWidth);
  const set = (next: number | null) => {
    const bounded = next === null ? null : Math.min(Math.max(next, min), Math.max(min, max()));
    setWidth(bounded);
    writeWidth(bounded);
  };
  return [width, set] as const;
}
