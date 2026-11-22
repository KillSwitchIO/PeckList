import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Whether a one-line title takes its compact form: measured before the browser paints, so the cut
 * one never shows. `key` names what the title says (a new one is tried whole again). `roomRef` is
 * the box whose width is the title's room, one its text doesn't size (a flex-grown heading); when
 * that changes, the whole title is tried again. Without layout (jsdom) nothing is ever cut.
 */
export function useCompactWhenCut<Text extends HTMLElement, Room extends HTMLElement>(key: string) {
  const ref = useRef<Text>(null);
  const roomRef = useRef<Room>(null);
  const [room, setRoom] = useState(0);
  const [compactFor, setCompactFor] = useState<string | null>(null);
  const at = `${key}|${room}`;
  const compact = compactFor === at;

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || compact) return;
    if (element.scrollWidth > element.clientWidth) setCompactFor(at);
  }, [compact, at]);

  useLayoutEffect(() => {
    const around = roomRef.current;
    if (!around || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setRoom(Math.round(entry.contentRect.width));
    });
    observer.observe(around);
    return () => observer.disconnect();
  }, []);

  return { ref, roomRef, compact };
}
