// Checking a task off with the bird (spec: PL-126): on Today it pops out of the box and carries
// the task to the Closed count ("delivery"); everywhere else it flies along the row, drawing the
// strike-through behind it ("swoop"). Drawn on a layer over the page, so the row itself is left
// alone, and over in well under a second so ticking stays quick. The completion is written when
// the bird is done.

export type CheckOffStyle = 'swoop' | 'deliver';

/** The bird's facets (darkest to lightest is not the order: each is one face) and its details. */
export interface BirdColors {
  facets: readonly [string, string, string, string, string, string];
  edge: string;
  beak: string;
  eye: string;
  /** The tick's box and the strike-through. */
  tick: string;
  onTick: string;
  strike: string;
}

// The low-poly bird from the icon (perched, facing right), in a 56 by 46 box.
/** Which of the six facet colors. */
type Facet = 0 | 1 | 2 | 3 | 4 | 5;

const BODY: readonly [Facet, string][] = [
  [0, '6,42 16,36 22,44'],
  [1, '16,36 26,27 30,35'],
  [2, '16,36 30,35 22,44'],
  [3, '26,27 34,17 30,35'],
  [4, '34,17 42,12 41,20'],
  [5, '42,12 49,16 41,20'],
  [0, '34,17 41,20 30,35'],
  [1, '41,20 49,21 46,27'],
  [2, '41,20 46,27 30,35'],
  [3, '46,27 46,36 30,35'],
  [4, '46,36 36,45 30,35'],
  [5, '36,45 22,44 30,35'],
];
// Wings up, for flying.
const WINGS: readonly [Facet, string][] = [
  [2, '26,27 14,4 34,22'],
  [4, '26,27 30,6 34,20'],
];

const SVG = 'http://www.w3.org/2000/svg';

/** The longest a check-off waits for the bird before the task is written as done. */
const MAX_MS = 1000;

function polygon(parent: SVGElement, fill: string, points: string, edge?: string) {
  const shape = document.createElementNS(SVG, 'polygon');
  shape.setAttribute('points', points);
  shape.setAttribute('fill', fill);
  if (edge) {
    shape.setAttribute('stroke', edge);
    shape.setAttribute('stroke-width', '0.8');
    shape.setAttribute('stroke-linejoin', 'round');
  }
  parent.append(shape);
}

/** The bird, `width` pixels wide; flying has its wings up, perched has legs. */
function bird(
  layer: HTMLElement,
  colors: BirdColors,
  flying: boolean,
  width: number,
): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', flying ? '4 0 56 54' : '4 8 56 46');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(Math.round((width * (flying ? 54 : 46)) / 56)));
  svg.style.cssText = 'position:absolute;left:0;top:0;overflow:visible';
  if (flying)
    for (const [facet, points] of WINGS) polygon(svg, colors.facets[facet], points, colors.edge);
  for (const [facet, points] of BODY) polygon(svg, colors.facets[facet], points, colors.edge);
  polygon(svg, colors.beak, '49,16 58,19 49,21');
  const eye = document.createElementNS(SVG, 'circle');
  eye.setAttribute('cx', '44');
  eye.setAttribute('cy', '17');
  eye.setAttribute('r', '1.7');
  eye.setAttribute('fill', colors.eye);
  svg.append(eye);
  if (!flying) {
    const legs = document.createElementNS(SVG, 'path');
    legs.setAttribute('d', 'M32 45v6M39 44v7');
    legs.setAttribute('stroke', colors.beak);
    legs.setAttribute('stroke-width', '1.8');
    legs.setAttribute('stroke-linecap', 'round');
    svg.append(legs);
  }
  layer.append(svg);
  return svg;
}

/** The tick drawn over the row's box (the row's own turns done once the bird is done). */
function tick(layer: HTMLElement, box: DOMRect, colors: BirdColors) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', String(box.width));
  svg.setAttribute('height', String(box.height));
  svg.style.cssText = `position:absolute;left:${box.left}px;top:${box.top}px;overflow:visible`;
  const fill = document.createElementNS(SVG, 'rect');
  fill.setAttribute('width', '16');
  fill.setAttribute('height', '16');
  fill.setAttribute('rx', '4');
  fill.setAttribute('fill', colors.tick);
  const mark = document.createElementNS(SVG, 'path');
  mark.setAttribute('d', 'M3.5 8.5l3 3 6-7');
  mark.setAttribute('fill', 'none');
  mark.setAttribute('stroke', colors.onTick);
  mark.setAttribute('stroke-width', '2.4');
  mark.setAttribute('stroke-linecap', 'round');
  mark.setAttribute('stroke-linejoin', 'round');
  mark.setAttribute('stroke-dasharray', '14');
  svg.append(fill, mark);
  layer.append(svg);
  fill.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 90, fill: 'forwards' });
  svg.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }],
    {
      duration: 220,
      easing: 'ease-out',
    },
  );
  mark.animate([{ strokeDashoffset: 14 }, { strokeDashoffset: 0 }], {
    duration: 140,
    fill: 'forwards',
    easing: 'ease-out',
  });
}

/** A line struck through the title's first line, left to right. */
function strike(
  layer: HTMLElement,
  title: DOMRect,
  colors: BirdColors,
  duration: number,
  delay: number,
) {
  const lineHeight = Math.min(title.height, 24);
  const line = document.createElement('div');
  line.style.cssText = `position:absolute;left:${title.left}px;top:${title.top + lineHeight * 0.55}px;width:${title.width}px;height:1.6px;background:${colors.strike};transform-origin:left;transform:scaleX(0)`;
  layer.append(line);
  line.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], {
    duration,
    delay,
    fill: 'forwards',
    easing: 'ease-out',
  });
}

const flight = (element: Element, frames: Keyframe[], options: KeyframeAnimationOptions) =>
  element.animate(frames, { fill: 'forwards', ...options }).finished;

async function swoop(layer: HTMLElement, row: DOMRect, title: DOMRect, colors: BirdColors) {
  const flier = bird(layer, colors, true, 28);
  const y = title.top + Math.min(title.height, 24) / 2 - 22;
  const from = title.left - 26;
  const to = title.left + title.width - 6;
  const run = 430;
  strike(layer, title, colors, run - 60, 40);
  await flight(
    flier,
    [
      { transform: `translate(${from}px, ${y - 10}px) rotate(6deg)`, opacity: 0 },
      { transform: `translate(${from + 12}px, ${y}px) rotate(0deg)`, opacity: 1, offset: 0.12 },
      {
        transform: `translate(${(from + to) / 2}px, ${y + 3}px) rotate(-2deg)`,
        opacity: 1,
        offset: 0.55,
      },
      { transform: `translate(${to}px, ${y}px) rotate(-6deg)`, opacity: 1, offset: 0.9 },
      {
        transform: `translate(${Math.min(row.right + 10, to + 40)}px, ${y - 22}px) rotate(-16deg)`,
        opacity: 0,
      },
    ],
    { duration: run + 90, easing: 'cubic-bezier(.45,.05,.4,1)' },
  );
}

async function deliver(
  layer: HTMLElement,
  box: DOMRect,
  title: DOMRect,
  target: DOMRect | null,
  colors: BirdColors,
) {
  strike(layer, title, colors, 200, 60);
  const perched = bird(layer, colors, false, 24);
  const flier = bird(layer, colors, true, 24);
  flier.style.opacity = '0';
  const x = box.left + box.width / 2 - 12;
  const y = box.top - 12;
  await flight(
    perched,
    [
      { transform: `translate(${x}px, ${y + 14}px) scale(.2)`, opacity: 0 },
      { transform: `translate(${x}px, ${y - 6}px) scale(1.05)`, opacity: 1, offset: 0.7 },
      { transform: `translate(${x}px, ${y - 4}px) scale(1)`, opacity: 1 },
    ],
    { duration: 170, easing: 'ease-out' },
  );
  // One flap: the wings-up bird takes over.
  perched.style.visibility = 'hidden';
  flier.style.opacity = '1';
  flier.style.transform = `translate(${x}px, ${y - 8}px)`;
  await new Promise((resolve) => setTimeout(resolve, 70));
  // To the Closed count, or up and away when there is none on screen yet.
  const height = window.innerHeight;
  const tx = target ? target.left + target.width / 2 - 12 : x + 120;
  const ty = target
    ? Math.min(Math.max(target.top + target.height / 2 - 16, -20), height - 10)
    : y - 90;
  await flight(
    flier,
    [
      { transform: `translate(${x}px, ${y - 8}px) scale(1)`, opacity: 1 },
      {
        transform: `translate(${(x + tx) / 2 + 30}px, ${Math.min(y, ty) - 24}px) scale(.9)`,
        opacity: 1,
        offset: 0.55,
      },
      { transform: `translate(${tx}px, ${ty}px) scale(.55)`, opacity: 0.2 },
    ],
    { duration: 300, easing: 'cubic-bezier(.4,0,.3,1)' },
  );
}

/** The Closed group's count on screen, where Delivery flies to. */
function closedCount(): Element | null {
  return document.querySelector('[data-group-count="completed"]');
}

/** A little bump on the Closed count once the task has landed in it. */
export function bumpClosedCount(): void {
  const count = closedCount();
  if (!count || typeof count.animate !== 'function' || reducedMotion()) return;
  count.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.5)' }, { transform: 'scale(1)' }],
    {
      duration: 240,
      easing: 'ease-out',
    },
  );
}

function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Play the bird over the row whose checkbox is `checkbox`. Resolves when the bird is done (the
 * caller then writes the completion), or is null when nothing plays: reduced motion, or no Web
 * Animations (tests), so the caller completes at once.
 */
export function playCheckOff(
  checkbox: HTMLElement,
  style: CheckOffStyle,
  colors: BirdColors,
): Promise<void> | null {
  if (reducedMotion() || typeof checkbox.animate !== 'function' || document.hidden) return null;
  let row: HTMLElement | null = checkbox.parentElement;
  while (row && !row.querySelector('[data-row-title]')) row = row.parentElement;
  const titleElement = row?.querySelector('[data-row-title]');
  if (!row || !titleElement) return null;
  const box = (checkbox.firstElementChild ?? checkbox).getBoundingClientRect();
  // The words, not the whole row: the strike and the swoop end where the title does.
  const room = titleElement.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(titleElement);
  const words =
    typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : room;
  const title =
    words.width > 0
      ? new DOMRect(room.left, room.top, Math.min(words.width, room.width), room.height)
      : room;
  const layer = document.createElement('div');
  layer.setAttribute('aria-hidden', 'true');
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2000;overflow:hidden';
  document.body.append(layer);
  tick(layer, box, colors);
  const target = closedCount()?.getBoundingClientRect() ?? null;
  const played =
    style === 'deliver'
      ? deliver(layer, box, title, target && target.height > 0 ? target : null, colors)
      : swoop(layer, row.getBoundingClientRect(), title, colors);
  // The layer stays until the next frame, by which the row has redrawn as done (and the rows
  // under it have moved up); a page in the background draws no frames, so it goes anyway.
  const clear = () => {
    requestAnimationFrame(() => layer.remove());
    setTimeout(() => layer.remove(), 100);
  };
  // Never longer than a second, even if the page stops animating (sent to the background).
  const limit = new Promise<void>((resolve) => setTimeout(resolve, MAX_MS));
  return Promise.race([played, limit]).then(clear, clear);
}
