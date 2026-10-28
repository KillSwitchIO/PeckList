// Hidden fun (R-FB-122): fifteen small surprises, each behind its own trigger. Nothing here changes
// any data; with reduced motion asked for, only a short line says what was found.

export type Egg =
  | 'confetti'
  | 'roll'
  | 'pinata'
  | 'retro'
  | 'gravity'
  | 'dog'
  | 'fireworks'
  | 'duck'
  | 'wink'
  | 'disco'
  | 'season'
  | 'trophy'
  | 'matrix'
  | 'typewriter'
  | 'mascot';

/** Every egg and what sets it off, for the docs and for Ben to choose from. */
export const EGGS: readonly { egg: Egg; trigger: string }[] = [
  { egg: 'confetti', trigger: 'The Konami code, or "party time" in search' },
  { egg: 'roll', trigger: '"do a barrel roll" in search' },
  { egg: 'pinata', trigger: 'Completing a task with "piñata" in its title' },
  { egg: 'retro', trigger: '"insert coin" in search' },
  { egg: 'gravity', trigger: 'Shaking the phone' },
  { egg: 'dog', trigger: 'Holding the + button for 3 seconds' },
  { egg: 'fireworks', trigger: 'Finishing the last open task of Today' },
  { egg: 'duck', trigger: 'Posting the comment "quack"' },
  { egg: 'wink', trigger: 'Tapping Today 5 times quickly' },
  { egg: 'disco', trigger: 'Picking 5 palettes within 20 seconds' },
  { egg: 'season', trigger: 'Pulling to refresh 3 times in a row' },
  { egg: 'trophy', trigger: 'Emptying the Mess Drawer' },
  { egg: 'matrix', trigger: '"follow the white rabbit" in search' },
  { egg: 'typewriter', trigger: 'Titling a task "clickety clack" (new or renamed)' },
  { egg: 'mascot', trigger: 'Completing 5 tasks within 2 minutes' },
];

const EVENT = 'punchlist-egg';

/** Words that, typed into search, set off a surprise. */
const WORDS: Record<string, Egg> = {
  'party time': 'confetti',
  confetti: 'confetti',
  'do a barrel roll': 'roll',
  'insert coin': 'retro',
  'follow the white rabbit': 'matrix',
};

const plain = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ');

/** The surprise a search hides, if any. */
export function eggFor(query: string): Egg | null {
  return WORDS[plain(query)] ?? null;
}

/** A task title that sets off typewriter mode once added. */
export const isTypewriterTitle = (title: string) => plain(title) === 'clickety clack';
/** A completed task that bursts like a piñata. */
export const isPinataTitle = (title: string) => /pi[ñn]ata/i.test(title);
/** A comment the rubber duck answers. */
export const isQuack = (body: string) => /^quack[.!]*$/.test(plain(body));

let listening = 0;
/** Eggs hatched before anything listened (a search link opened straight): handed over then. */
let waiting: Egg[] = [];

export function hatch(egg: Egg): void {
  if (listening === 0) {
    waiting.push(egg);
    return;
  }
  window.dispatchEvent(new CustomEvent<Egg>(EVENT, { detail: egg }));
}

export function onHatch(handler: (egg: Egg) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<Egg>).detail);
  window.addEventListener(EVENT, listener);
  listening += 1;
  const early = waiting;
  waiting = [];
  for (const egg of early) handler(egg);
  return () => {
    window.removeEventListener(EVENT, listener);
    listening -= 1;
  };
}

const bursts = new Map<string, number[]>();

/**
 * Note one more of something (a tap, a pull, a pick): true when it is the `count`th within
 * `withinMs`, which starts the count over.
 */
export function burst(key: string, count: number, withinMs: number, now = Date.now()): boolean {
  const recent = (bursts.get(key) ?? []).filter((at) => now - at < withinMs);
  recent.push(now);
  if (recent.length >= count) {
    bursts.delete(key);
    return true;
  }
  bursts.set(key, recent);
  return false;
}

/** A pull to refresh: the third in a row lets the season fall (R-FB-122). */
export function notePull(): void {
  if (burst('pull', 3, 30_000)) hatch('season');
}

/** A palette picked: the fifth within 20 seconds starts the disco. */
export function notePalettePick(): void {
  if (burst('palette', 5, 20_000)) hatch('disco');
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

/** What falls in each season when the season egg hatches (northern hemisphere months). */
export function seasonOf(month: number): {
  pieces: string[];
  name: 'winter' | 'spring' | 'summer' | 'autumn';
} {
  if (month === 12 || month <= 2) return { pieces: ['❄️', '❅', '❆'], name: 'winter' };
  if (month <= 5) return { pieces: ['🌸', '🌼', '💮'], name: 'spring' };
  if (month <= 8) return { pieces: ['🫧', '☀️', '✨'], name: 'summer' };
  return { pieces: ['🍂', '🍁', '🍃'], name: 'autumn' };
}
