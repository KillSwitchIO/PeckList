import { Box } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n/i18n.ts';
import { konamiTracker, onHatch, hatch, type Egg } from './eggs.ts';

const COLORS = ['#FF2E93', '#FFC300', '#00B8F0', '#7CB518', '#A06CD5', '#FF6B00'];
const PIECES = 160;
const CONFETTI_MS = 3200;

/** Confetti over everything for a few seconds, drawn on one canvas. */
function Confetti({ onDone }: { onDone: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) {
      onDone();
      return;
    }
    const width = (element.width = window.innerWidth);
    const height = (element.height = window.innerHeight);
    const pieces = Array.from({ length: PIECES }, () => ({
      x: Math.random() * width,
      y: -20 - Math.random() * height * 0.5,
      size: 6 + Math.random() * 6,
      fall: 2 + Math.random() * 3,
      drift: (Math.random() - 0.5) * 2,
      spin: Math.random() * Math.PI,
      turn: (Math.random() - 0.5) * 0.3,
      color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
    }));
    const start = performance.now();
    let frame = 0;
    const draw = (now: number) => {
      context.clearRect(0, 0, width, height);
      for (const piece of pieces) {
        piece.y += piece.fall;
        piece.x += piece.drift;
        piece.spin += piece.turn;
        context.save();
        context.translate(piece.x, piece.y);
        context.rotate(piece.spin);
        context.fillStyle = piece.color;
        context.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
        context.restore();
      }
      if (now - start < CONFETTI_MS) frame = requestAnimationFrame(draw);
      else onDone();
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [onDone]);
  return (
    <Box
      component="canvas"
      ref={canvas}
      aria-hidden
      sx={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100dvh',
        pointerEvents: 'none',
        zIndex: (theme) => theme.zIndex.tooltip + 1,
      }}
    />
  );
}

/**
 * The hidden fun (R-FB-122): the Konami code or "party time" in search rains confetti; "do a
 * barrel roll" in search spins the page once. With reduced motion asked for, a short line says
 * what was found instead.
 */
export function EasterEggs() {
  const [playing, setPlaying] = useState<Egg | null>(null);
  const [found, setFound] = useState<string | null>(null);

  useEffect(() => {
    const konami = konamiTracker();
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      if (konami(event.key)) hatch('confetti');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(
    () =>
      onHatch((egg) => {
        const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
        setFound(egg === 'roll' ? t('fun.roll') : t('fun.confetti'));
        if (still) return;
        if (egg === 'roll') {
          const root = document.getElementById('root') ?? document.body;
          root.animate?.([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], {
            duration: 1100,
            easing: 'cubic-bezier(0.45, 0, 0.2, 1)',
          });
          return;
        }
        setPlaying(egg);
      }),
    [],
  );

  useEffect(() => {
    if (!found) return;
    const timer = setTimeout(() => setFound(null), 2600);
    return () => clearTimeout(timer);
  }, [found]);

  return (
    <>
      {playing === 'confetti' && <Confetti onDone={() => setPlaying(null)} />}
      {found && (
        <Box
          role="status"
          sx={{
            position: 'fixed',
            top: 72,
            left: '50%',
            transform: 'translateX(-50%)',
            px: 2,
            py: 0.75,
            borderRadius: 99,
            bgcolor: 'text.primary',
            color: 'background.paper',
            typography: 'body2',
            boxShadow: 6,
            zIndex: (theme) => theme.zIndex.tooltip + 2,
            pointerEvents: 'none',
          }}
        >
          {found}
        </Box>
      )}
    </>
  );
}
