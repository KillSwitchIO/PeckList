import { describe, expect, it } from 'vitest';
import { claimTouch, claimTouches, claimTouchesRef, touchClaimed } from './claimTouch.ts';

const touchStart = () => new Event('touchstart', { bubbles: true }) as TouchEvent;

describe('claiming a touch for one gesture', () => {
  it('marks the touch for MUI and for our own pulls', () => {
    const event = touchStart();
    expect(touchClaimed(event)).toBe(false);
    claimTouch(event);
    expect(touchClaimed(event)).toBe(true);
    expect((event as TouchEvent & { defaultMuiPrevented?: boolean }).defaultMuiPrevented).toBe(
      true,
    );
  });

  it('claims touches that start on the element, before its ancestors and the document hear them', () => {
    const outer = document.createElement('div');
    const handle = document.createElement('span');
    outer.append(handle);
    document.body.append(outer);
    const seen: boolean[] = [];
    const listen = (event: Event) => seen.push(touchClaimed(event as TouchEvent));
    outer.addEventListener('touchstart', listen);
    document.addEventListener('touchstart', listen);

    const stop = claimTouches(handle);
    handle.dispatchEvent(touchStart());
    // A touch beside the handle is nobody's.
    outer.dispatchEvent(touchStart());
    stop();
    handle.dispatchEvent(touchStart());
    expect(seen).toEqual([true, true, false, false, false, false]);

    outer.removeEventListener('touchstart', listen);
    document.removeEventListener('touchstart', listen);
    outer.remove();
  });

  it('works as a React ref, with its cleanup', () => {
    const handle = document.createElement('span');
    const cleanup = claimTouchesRef(handle);
    const first = touchStart();
    handle.dispatchEvent(first);
    cleanup?.();
    const second = touchStart();
    handle.dispatchEvent(second);
    expect([touchClaimed(first), touchClaimed(second)]).toEqual([true, false]);
    expect(claimTouchesRef(null)).toBeUndefined();
  });

  it('claims on an SVG icon as well', () => {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const stop = claimTouches(icon);
    const event = touchStart();
    icon.dispatchEvent(event);
    stop();
    expect(touchClaimed(event)).toBe(true);
  });
});
