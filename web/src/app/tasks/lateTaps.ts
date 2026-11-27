/** How long a tap where the button was still counts as meant for it. */
export const LATE_TAP_MS = 500;
/** The longest a press begun in that time is followed to its click. */
const TAP_MAX_MS = 1000;

type Area = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>;

const PRESS = ['pointerdown', 'mousedown'] as const;
const REST = ['pointerup', 'mouseup', 'click', 'dblclick', 'contextmenu'] as const;

let release: (() => void) | null = null;

/**
 * A button that goes away on its own (Undo) leaves whatever was under it in reach of a tap meant
 * for it: on a phone, Undo sits over the Month grid's lower-left day, and a tap a moment too late
 * opened that day. For a short while after it goes, a tap inside its box is let fall: the press,
 * and the release and click that follow it, go nowhere. Taps anywhere else, and every tap after
 * that short while, go through as always. One area at a time; a new one, or
 * {@link releaseLateTaps}, ends the last.
 */
export function holdLateTaps(area: Area, ms = LATE_TAP_MS) {
  releaseLateTaps();
  // Nothing was drawn there (or there is no layout to say where).
  if (area.right <= area.left || area.bottom <= area.top) return;
  let open = true;
  // A press let fall: its release and click go too, even after the time is up.
  let pressed = false;
  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  const inside = (event: MouseEvent) =>
    event.clientX >= area.left &&
    event.clientX <= area.right &&
    event.clientY >= area.top &&
    event.clientY <= area.bottom;
  const drop = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const onPress = (event: Event) => {
    if (!open || !inside(event as MouseEvent)) return;
    drop(event);
    pressed = true;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      pressed = false;
      if (!open) end();
    }, TAP_MAX_MS);
  };
  const onRest = (event: Event) => {
    if (!pressed && !(open && inside(event as MouseEvent))) return;
    drop(event);
    if (event.type === 'click') {
      pressed = false;
      if (!open) end();
    }
  };
  const end = () => {
    clearTimeout(timer);
    clearTimeout(pressTimer);
    for (const type of PRESS) window.removeEventListener(type, onPress, true);
    for (const type of REST) window.removeEventListener(type, onRest, true);
    if (release === end) release = null;
  };
  // Ahead of everything else: the window, in the capture phase.
  for (const type of PRESS) window.addEventListener(type, onPress, true);
  for (const type of REST) window.addEventListener(type, onRest, true);
  const timer = setTimeout(() => {
    open = false;
    if (!pressed) end();
  }, ms);
  release = end;
}

/** Taps where the button was go through again (it is back, or something else needs them). */
export function releaseLateTaps() {
  release?.();
}
