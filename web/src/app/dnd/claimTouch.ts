// One touch, one gesture. A gesture that owns a touch from where it starts (a reorder handle, a
// drag) claims it, and the gestures around it that hear the same touch leave it alone:
// - a bottom sheet it sits in: MUI's SwipeableDrawer swipes from a document listener and steps
//   aside for a touch marked with MUI's own claim, `defaultMuiPrevented`;
// - the comments pull (usePullUp), which asks `touchClaimed` (any other gesture can too).
// Pointer capture or preventDefault does neither: touch events still reach those listeners.

const CLAIMED = Symbol('pecklist.claimedTouch');

type Marked = TouchEvent & { defaultMuiPrevented?: boolean; [CLAIMED]?: true };

/**
 * Claim this touch (call it on the touch's touchstart, before it reaches the gestures around
 * it): no bottom sheet swipes on it, and no pull starts from it.
 */
export function claimTouch(event: TouchEvent): void {
  const marked = event as Marked;
  marked.defaultMuiPrevented = true;
  marked[CLAIMED] = true;
}

/** Whether something under the finger claimed this touch (its touchstart) for its own gesture. */
export function touchClaimed(event: TouchEvent): boolean {
  return (event as Marked)[CLAIMED] === true;
}

/** Claim every touch that starts on `element`. Returns how to stop. */
export function claimTouches(element: Element): () => void {
  // On the element itself, so it runs before the listeners around it (they are on its ancestors,
  // the document and the window).
  const onStart = (event: Event) => claimTouch(event as TouchEvent);
  element.addEventListener('touchstart', onStart, { passive: true });
  return () => element.removeEventListener('touchstart', onStart);
}

/** `claimTouches` as a React ref, on any element (an SVG icon too): `<Box ref={claimTouchesRef}>`. */
export function claimTouchesRef(element: Element | null): (() => void) | undefined {
  return element ? claimTouches(element) : undefined;
}
