// Hidden fun (R-FB-122): a few secret words and the Konami code set off a small surprise. Nothing
// here changes any data; with reduced motion asked for, only a short line says what was found.

export type Egg = 'confetti' | 'roll';

const EVENT = 'punchlist-egg';

/** Words that, typed into search, set off a surprise. */
const WORDS: Record<string, Egg> = {
  'party time': 'confetti',
  confetti: 'confetti',
  'do a barrel roll': 'roll',
};

/** The surprise a search hides, if any. */
export function eggFor(query: string): Egg | null {
  return WORDS[query.trim().toLowerCase().replace(/\s+/g, ' ')] ?? null;
}

export function hatch(egg: Egg): void {
  window.dispatchEvent(new CustomEvent<Egg>(EVENT, { detail: egg }));
}

export function onHatch(handler: (egg: Egg) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<Egg>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

/** Up, up, down, down, left, right, left, right, B, A. */
export const KONAMI = [
  'ArrowUp',
  'ArrowUp',
  'ArrowDown',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowLeft',
  'ArrowRight',
  'b',
  'a',
];

/** Follows keys as typed: true once the whole code has gone by. */
export function konamiTracker(): (key: string) => boolean {
  let at = 0;
  return (key) => {
    const wanted = KONAMI[at];
    const pressed = key.length === 1 ? key.toLowerCase() : key;
    if (pressed === wanted) at += 1;
    else at = pressed === KONAMI[0] ? 1 : 0;
    if (at < KONAMI.length) return false;
    at = 0;
    return true;
  };
}
