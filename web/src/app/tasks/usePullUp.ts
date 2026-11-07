import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

// How the comments panel comes up under a finger on a phone (R-FB-109). Change the feel here.
/** It stays once pulled this share of its height. */
export const PULL_OPEN_SHARE = 1 / 3;
/** A fling this fast (px per ms) also opens it... */
export const PULL_FLING_SPEED = 1;
/** ...if it has come at least this far, so a quick flick does not. */
export const PULL_FLING_MIN_PX = 80;
/** Moving less than this is a tap or a wobble, not a pull. */
const PULL_SLOP_PX = 10;
/** How long it takes to finish rising or to slide back after the finger lets go. */
export const PULL_SETTLE_MS = 225;
/** How often the browser reports a finger once a scroll has started (Chrome on Android). */
const PULL_STEPPED_MS = 200;
/** The speed of a fling is measured over this last stretch of the movement. */
const FLING_WINDOW_MS = 100;

/** Whether a release leaves the panel open. */
export function pullOpens(pulled: number, height: number, speed: number): boolean {
  if (pulled >= height * PULL_OPEN_SHARE) return true;
  return pulled >= PULL_FLING_MIN_PX && speed >= PULL_FLING_SPEED;
}

/**
 * `drag`: following the finger. `settle`: rising or sliding back after it let go. `dropped`: slid
 * back, so the sheet leaves without its own animation.
 */
export type PullPhase = 'drag' | 'settle' | 'dropped' | null;

export interface PullUp {
  phase: PullPhase;
  /** On the sheet's root: it carries the position, set directly so a move does not re-render. */
  sheet: (root: HTMLElement | null) => void;
  /** Whether the sheet should show because of a pull, whatever `open` says. */
  showing: boolean;
  /** Make an element a place to pull from. Returns how to stop. */
  attach: (element: HTMLElement, atEnd: () => boolean) => () => void;
}

const reducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Brings a sheet up with the finger, from any element attached: the sheet follows 1:1, and on
 * release it finishes rising if it came far enough (`pullOpens`) or slides back.
 */
export function usePullUp(open: boolean, setOpen: (open: boolean) => void): PullUp {
  const [phase, setPhase] = useState<PullPhase>(null);
  const root = useRef<HTMLElement | null>(null);
  const pulled = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const openNow = useRef(open);
  useEffect(() => {
    openNow.current = open;
  }, [open]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const heightOf = () =>
    root.current?.querySelector<HTMLElement>('.MuiDrawer-paper')?.offsetHeight ||
    window.innerHeight;
  const place = useCallback((px: number, height = heightOf()) => {
    pulled.current = px;
    const style = root.current?.style;
    style?.setProperty('--pull-px', `${px}px`);
    style?.setProperty('--pull-share', String(Math.min(1, px / height)));
  }, []);
  // The sheet only exists a moment after the first move: it starts where the finger has got to.
  const sheet = useCallback(
    (node: HTMLElement | null) => {
      root.current = node;
      if (node) place(pulled.current);
    },
    [place],
  );

  const release = useCallback(
    (speed: number) => {
      clearTimeout(timer.current);
      const height = heightOf();
      const stays = pullOpens(pulled.current, height, speed);
      // The glide must be on the sheet before it is moved, or it jumps: from a native listener a
      // plain update would only commit after the move has been styled.
      flushSync(() => setPhase('settle'));
      place(stays ? height : 0, height);
      timer.current = setTimeout(
        () => {
          if (stays) {
            setOpen(true);
            setPhase(null);
            root.current?.querySelector<HTMLElement>('[tabindex="-1"]')?.focus();
          } else {
            setPhase('dropped');
            timer.current = setTimeout(() => setPhase(null), 50);
          }
        },
        reducedMotion() ? 0 : PULL_SETTLE_MS,
      );
    },
    [place, setOpen],
  );

  /** Lets go of a pull at once, with no glide: the sheet leaves the usual way. */
  const drop = useCallback(() => {
    clearTimeout(timer.current);
    pulled.current = 0;
    setPhase(null);
  }, []);

  const attach = useCallback(
    (element: HTMLElement, atEnd: () => boolean) => {
      let anchor: number | null = null;
      let startX = 0;
      let active = false;
      let samples: { y: number; at: number }[] = [];

      // A pull cut off (a second finger, or the element going while one is held) settles, so
      // the sheet is never left half up and impossible to close.
      const cutOff = () => {
        if (!active) return;
        active = false;
        release(0);
      };
      const onStart = (event: TouchEvent) => {
        cutOff();
        const touch = event.touches[0];
        // From the first touch: a quick flick may only deliver one move.
        samples = touch ? [{ y: touch.clientY, at: event.timeStamp }] : [];
        anchor = touch && event.touches.length === 1 && !openNow.current ? touch.clientY : null;
        startX = touch?.clientX ?? 0;
      };
      const onMove = (event: TouchEvent) => {
        const touch = event.touches[0];
        if (anchor === null || !touch) return;
        if (event.touches.length > 1) {
          if (active) release(0);
          anchor = null;
          active = false;
          return;
        }
        const y = touch.clientY;
        if (!active) {
          // Scrolling comes first: the pull is measured from where the scroll ran out. Moving back
          // down counts from there too, so only a move up can start it.
          if (!atEnd() || y > anchor) {
            anchor = y;
            return;
          }
          const up = anchor - y;
          if (up < PULL_SLOP_PX) return;
          if (Math.abs(touch.clientX - startX) > up) {
            anchor = null;
            return;
          }
          active = true;
          anchor -= PULL_SLOP_PX;
          pulled.current = 0;
          // The last pull's slide back may not have finished: its timer must not end this one.
          clearTimeout(timer.current);
          setPhase('drag');
        }
        // Past the first move of a scroll the browser no longer lets this be stopped, and only
        // reports the finger now and then: the sheet eases between reports instead of stepping.
        if (event.cancelable) event.preventDefault();
        root.current?.style.setProperty(
          '--pull-ease',
          `${event.cancelable ? 0 : PULL_STEPPED_MS}ms`,
        );
        place(Math.min(heightOf(), Math.max(0, anchor - y)));
        const at = event.timeStamp;
        samples.push({ y, at });
        samples = samples.filter((each) => at - each.at <= FLING_WINDOW_MS);
      };
      const onEnd = (event: TouchEvent) => {
        if (!active) {
          anchor = null;
          return;
        }
        active = false;
        anchor = null;
        const first = samples[0];
        const last = samples.at(-1);
        const recent = last && event.timeStamp - last.at <= FLING_WINDOW_MS;
        const speed =
          first && last && recent && last.at > first.at
            ? (first.y - last.y) / (last.at - first.at)
            : 0;
        release(event.type === 'touchcancel' ? 0 : speed);
      };

      element.addEventListener('touchstart', onStart, { passive: true });
      // Not passive: on a short task nothing else may scroll the page while the panel comes up.
      element.addEventListener('touchmove', onMove, { passive: false });
      element.addEventListener('touchend', onEnd);
      element.addEventListener('touchcancel', onEnd);
      return () => {
        // Not `release`: this runs while React commits, where it cannot flush the glide.
        if (active) drop();
        active = false;
        element.removeEventListener('touchstart', onStart);
        element.removeEventListener('touchmove', onMove);
        element.removeEventListener('touchend', onEnd);
        element.removeEventListener('touchcancel', onEnd);
      };
    },
    [place, release, drop],
  );

  return { phase, sheet, showing: phase === 'drag' || phase === 'settle', attach };
}
