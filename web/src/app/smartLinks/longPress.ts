// A long press on a smart link (PL-146) offers its choices on a touch screen. Chrome on Android
// sends no contextmenu event for a long press on plain text (it starts a selection instead), so
// the press is timed from the finger's own pointer events.

/** How long a finger rests before it counts as a long press, and how far it may wander. */
const HOLD_MS = 500;
const SLOP_PX = 10;

export interface LongPress {
  /** A finger (or pen) went down; `fire` runs if it stays put long enough. Mice are ignored. */
  down(event: PointerEvent, fire: () => void): void;
  /** The pointer moved: too far, and it is a scroll or a selection, not a press. */
  move(event: PointerEvent): void;
  /** The pointer went up or away: no long press from here on. */
  cancel(): void;
  /** Whether the press that just ended was a long one, so its click does nothing more. Once. */
  takeFired(): boolean;
}

export function createLongPress(): LongPress {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let start: { x: number; y: number } | null = null;
  let fired = false;
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    start = null;
  };
  return {
    down(event, fire) {
      cancel();
      fired = false;
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
      start = { x: event.clientX, y: event.clientY };
      timer = setTimeout(() => {
        timer = undefined;
        start = null;
        fired = true;
        fire();
        // Android selects the word under a long press too, with its handles over the choices:
        // the choices are what the press asked for, so the selection goes (now, and once the
        // phone's own long press, which may come a little later, has run).
        const clear = () => window.getSelection()?.removeAllRanges();
        clear();
        setTimeout(clear, 300);
      }, HOLD_MS);
    },
    move(event) {
      if (!start) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > SLOP_PX) cancel();
    },
    cancel,
    takeFired() {
      const was = fired;
      fired = false;
      return was;
    },
  };
}
