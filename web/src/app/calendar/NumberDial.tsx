import { keyframes } from '@emotion/react';
import { Box, Portal } from '@mui/material';
import { useEffect, useRef, useState } from 'react';

/** Radius of the open dial, and of the ring its numbers sit on. */
const RADIUS = 124;
const RING = RADIUS - 30;
/** Nearer the middle than this, the finger picks nothing (it is still finding its way). */
const DEAD = 30;
/** A press that moves this far is a drag around the dial, not a tap. */
const MOVE_PX = 8;

const grow = keyframes`
  from { transform: scale(0.15); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
`;

/** Degrees clockwise from the top of the dial for each value: an arc open at the bottom. */
function angles(count: number) {
  const span = Math.min(270, (count - 1) * 45);
  return Array.from({ length: count }, (_, i) =>
    count === 1 ? 0 : -span / 2 + (span * i) / (count - 1),
  );
}

/** The value whose spot is nearest the finger, or null when it is too near the middle. */
function pick(values: number[], dx: number, dy: number) {
  if (Math.hypot(dx, dy) < DEAD) return null;
  const at = (Math.atan2(dx, -dy) * 180) / Math.PI;
  const spots = angles(values.length);
  let best = 0;
  spots.forEach((spot, i) => {
    if (Math.abs(spot - at) < Math.abs((spots[best] ?? 0) - at)) best = i;
  });
  return values[best] ?? null;
}

/**
 * A small round button holding a number (spec: PL-093, the calendar's days shown). Press and hold:
 * it opens into a dial, and the finger runs round it to pick; the number under it rings and grows,
 * the page follows as it goes, and letting go keeps it. A tap opens the dial to tap a number;
 * keys step it like a slider.
 */
export function NumberDial({
  values,
  value,
  onChange,
  label,
  caption,
}: {
  values: number[];
  value: number;
  /** Called as the pick changes, not only at the end, so what it controls follows live */
  onChange: (value: number) => void;
  label: string;
  /** The words in the middle of the open dial, for a value ("3 days") */
  caption: (value: number) => string;
}) {
  const button = useRef<HTMLDivElement>(null);
  const [dial, setDial] = useState<{ x: number; y: number; ox: number; oy: number } | null>(null);
  // Picking with a finger down right now (else open for a tap, or shut).
  const [pressing, setPressing] = useState(false);
  const latest = useRef({ value, onChange });
  useEffect(() => {
    latest.current = { value, onChange };
  });
  const original = useRef(value);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const set = (next: number | null, touch: boolean) => {
    if (next === null || next === latest.current.value) return;
    latest.current.onChange(next);
    if (touch) {
      try {
        navigator.vibrate?.(8);
      } catch {
        // No buzz on this device.
      }
    }
  };

  const open = () => {
    const box = button.current?.getBoundingClientRect();
    if (!box) return null;
    const bx = box.left + box.width / 2;
    const by = box.top + box.height / 2;
    const room = RADIUS + 8;
    const x = Math.min(Math.max(bx, room), Math.max(room, window.innerWidth - room));
    const y = Math.min(Math.max(by, room), Math.max(room, window.innerHeight - room));
    const next = { x, y, ox: bx - x + RADIUS, oy: by - y + RADIUS };
    original.current = latest.current.value;
    setDial(next);
    return next;
  };
  const close = () => {
    stop.current?.();
    setDial(null);
    setPressing(false);
  };

  /** Follow one finger (or the mouse) round the dial until it lets go. */
  const track = (
    event: React.PointerEvent,
    centre: { x: number; y: number },
    fromButton: boolean,
  ) => {
    stop.current?.();
    const id = event.pointerId;
    const touch = event.pointerType !== 'mouse';
    const origin = { x: event.clientX, y: event.clientY };
    let moved = !fromButton;
    setPressing(true);
    if (moved) set(pick(values, event.clientX - centre.x, event.clientY - centre.y), touch);
    const move = (next: PointerEvent) => {
      if (next.pointerId !== id) return;
      if (!moved && Math.hypot(next.clientX - origin.x, next.clientY - origin.y) < MOVE_PX) return;
      moved = true;
      next.preventDefault();
      set(pick(values, next.clientX - centre.x, next.clientY - centre.y), touch);
    };
    const up = (next: PointerEvent) => {
      if (next.pointerId !== id) return;
      done();
      setPressing(false);
      // A tap leaves the dial open to tap a number; a drag round it is the pick.
      if (moved) setDial(null);
    };
    const cancel = () => {
      done();
      latest.current.onChange(original.current);
      setDial(null);
      setPressing(false);
    };
    const done = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      stop.current = null;
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    stop.current = done;
  };

  const index = Math.max(0, values.indexOf(value));
  const step = (by: number) =>
    onChange(values[Math.min(values.length - 1, Math.max(0, index + by))]!);
  const spots = angles(values.length);

  return (
    <>
      <Box
        ref={button}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={values[0]}
        aria-valuemax={values[values.length - 1]}
        aria-valuenow={value}
        aria-valuetext={caption(value)}
        aria-expanded={dial !== null}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          const at = open();
          if (at) track(event, at, true);
        }}
        onKeyDown={(event) => {
          const by = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[event.key];
          if (by) {
            event.preventDefault();
            step(by);
          } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            onChange(event.key === 'Home' ? values[0]! : values[values.length - 1]!);
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (dial) close();
            else open();
          } else if (event.key === 'Escape' && dial) {
            close();
          }
        }}
        onBlur={() => {
          if (dial && !pressing) close();
        }}
        sx={{
          flexShrink: 0,
          width: 34,
          height: 34,
          borderRadius: '50%',
          border: 2,
          borderColor: 'primary.main',
          color: 'primary.main',
          display: 'grid',
          placeItems: 'center',
          fontWeight: 700,
          fontSize: 15,
          cursor: 'pointer',
          userSelect: 'none',
          touchAction: 'none',
          '&:hover': { bgcolor: 'action.hover' },
          '&:focus-visible': { outline: 2, outlineColor: 'primary.main', outlineOffset: 2 },
        }}
      >
        {value}
      </Box>
      {dial && (
        <Portal>
          <Box
            data-number-dial=""
            onPointerDown={(event) => {
              const dx = event.clientX - dial.x;
              const dy = event.clientY - dial.y;
              // Off the dial: shut it.
              if (Math.hypot(dx, dy) > RADIUS + 4) return close();
              event.preventDefault();
              track(event, dial, false);
            }}
            sx={{
              position: 'fixed',
              inset: 0,
              zIndex: (theme) => theme.zIndex.modal,
              touchAction: 'none',
              userSelect: 'none',
            }}
          >
            <Box
              aria-hidden
              sx={{
                position: 'absolute',
                left: dial.x - RADIUS,
                top: dial.y - RADIUS,
                width: RADIUS * 2,
                height: RADIUS * 2,
                borderRadius: '50%',
                bgcolor: 'background.paper',
                backgroundImage: 'none',
                boxShadow: 12,
                border: 1,
                borderColor: 'divider',
                transformOrigin: `${dial.ox}px ${dial.oy}px`,
                animation: `${grow} 180ms cubic-bezier(0.2, 0.9, 0.3, 1.2)`,
                '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
              }}
            >
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  display: 'grid',
                  placeItems: 'center',
                  alignContent: 'center',
                  pointerEvents: 'none',
                }}
              >
                <Box sx={{ fontSize: 34, fontWeight: 700, lineHeight: 1, color: 'primary.main' }}>
                  {value}
                </Box>
                <Box sx={{ fontSize: 12, color: 'text.secondary', mt: 0.5 }}>{caption(value)}</Box>
              </Box>
              {values.map((each, i) => {
                const angle = ((spots[i] ?? 0) * Math.PI) / 180;
                const chosen = each === value;
                return (
                  <Box
                    key={each}
                    data-dial-value={each}
                    sx={{
                      position: 'absolute',
                      left: RADIUS + RING * Math.sin(angle) - 16,
                      top: RADIUS - RING * Math.cos(angle) - 16,
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 14,
                      fontWeight: chosen ? 700 : 500,
                      color: chosen ? 'primary.contrastText' : 'text.primary',
                      bgcolor: chosen ? 'primary.main' : 'transparent',
                      boxShadow: chosen ? 4 : 0,
                      transform: chosen ? 'scale(1.4)' : 'scale(1)',
                      transition: 'transform 120ms ease-out, background-color 120ms',
                      zIndex: chosen ? 1 : 0,
                    }}
                  >
                    {each}
                  </Box>
                );
              })}
            </Box>
          </Box>
        </Portal>
      )}
    </>
  );
}
