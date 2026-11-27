import { fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { holdLateTaps, LATE_TAP_MS, releaseLateTaps } from './lateTaps.ts';

// Where Undo was: 48 px, bottom left.
const AREA = { left: 16, top: 700, right: 64, bottom: 748 };
const IN = { clientX: 30, clientY: 720 };
const OUT = { clientX: 120, clientY: 720 };

describe('late taps where a button was', () => {
  let target: HTMLElement;
  let got: string[];
  beforeEach(() => {
    vi.useFakeTimers();
    target = document.createElement('div');
    document.body.append(target);
    got = [];
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click']) {
      target.addEventListener(type, () => got.push(type));
    }
  });
  afterEach(() => {
    releaseLateTaps();
    target.remove();
    vi.useRealTimers();
  });

  const tap = (at: typeof IN) => {
    fireEvent.pointerDown(target, at);
    fireEvent.mouseDown(target, at);
    fireEvent.pointerUp(target, at);
    fireEvent.mouseUp(target, at);
    fireEvent.click(target, at);
  };

  it('lets a tap inside fall for a moment, and passes taps elsewhere', () => {
    holdLateTaps(AREA);
    tap(IN);
    expect(got).toEqual([]);
    tap(OUT);
    expect(got).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
  });

  it('passes taps inside once the moment is over', () => {
    holdLateTaps(AREA);
    vi.advanceTimersByTime(LATE_TAP_MS);
    tap(IN);
    expect(got).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
  });

  it('follows a press let fall to its click, even past the moment', () => {
    holdLateTaps(AREA);
    vi.advanceTimersByTime(LATE_TAP_MS - 50);
    fireEvent.pointerDown(target, IN);
    vi.advanceTimersByTime(150);
    fireEvent.pointerUp(target, IN);
    fireEvent.click(target, IN);
    expect(got).toEqual([]);
    // That tap was the last.
    tap(IN);
    expect(got).toHaveLength(5);
  });

  it('holds nothing for a button with no size (never drawn)', () => {
    holdLateTaps({ left: 0, top: 0, right: 0, bottom: 0 });
    tap({ clientX: 0, clientY: 0 });
    expect(got).toHaveLength(5);
  });

  it('passes taps again when released (the button is back)', () => {
    holdLateTaps(AREA);
    releaseLateTaps();
    tap(IN);
    expect(got).toHaveLength(5);
  });
});
