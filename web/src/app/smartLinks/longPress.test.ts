import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLongPress } from './longPress.ts';

const pointer = (pointerType: string, clientX = 10, clientY = 10) =>
  ({ pointerType, clientX, clientY }) as PointerEvent;

describe('a long press on a smart link (PL-146)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires after a finger rests half a second, and swallows the click that ends it', () => {
    const press = createLongPress();
    const fire = vi.fn();
    press.down(pointer('touch'), fire);
    vi.advanceTimersByTime(499);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledOnce();
    press.cancel();
    expect(press.takeFired()).toBe(true);
    expect(press.takeFired()).toBe(false);
  });

  it('is no long press when the finger lifts early or moves away, or for a mouse', () => {
    const press = createLongPress();
    const fire = vi.fn();
    press.down(pointer('touch'), fire);
    vi.advanceTimersByTime(300);
    press.cancel();
    press.down(pointer('touch'), fire);
    press.move(pointer('touch', 30, 10));
    press.down(pointer('mouse'), fire);
    vi.advanceTimersByTime(1000);
    expect(fire).not.toHaveBeenCalled();
    expect(press.takeFired()).toBe(false);
  });

  it('a new press forgets an old long press whose click never came', () => {
    const press = createLongPress();
    press.down(pointer('touch'), () => undefined);
    vi.advanceTimersByTime(600);
    press.down(pointer('mouse'), () => undefined);
    expect(press.takeFired()).toBe(false);
  });
});
