import { Box } from '@mui/material';
import { useEffect, useRef } from 'react';

export type ParticleShow =
  | { kind: 'confetti' }
  | { kind: 'candy' }
  | { kind: 'season'; pieces: string[] }
  | { kind: 'fireworks' }
  | { kind: 'matrix'; words: string[] };

const COLORS = ['#FF2E93', '#FFC300', '#00B8F0', '#7CB518', '#A06CD5', '#FF6B00'];
const CANDY = ['🍬', '🍭', '🍫', '🍩', '🧁', '🍪'];
const LENGTH: Record<ParticleShow['kind'], number> = {
  confetti: 3200,
  candy: 3000,
  season: 7000,
  fireworks: 4200,
  matrix: 7000,
};

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  turn: number;
  size: number;
  color: string;
  text?: string;
  /** Frames it lives (fireworks sparks fade) */
  life: number;
  age: number;
}

const random = (low: number, high: number) => low + Math.random() * (high - low);
const pick = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)]!;

/** Pieces for a show to start with (fireworks and matrix add more as they go). */
function start(show: ParticleShow, width: number, height: number): Piece[] {
  const base = { spin: 0, turn: 0, age: 0, life: Infinity, color: '#fff' };
  switch (show.kind) {
    case 'confetti':
      return Array.from({ length: 160 }, () => ({
        ...base,
        x: random(0, width),
        y: random(-height * 0.5, -20),
        vx: random(-1, 1),
        vy: random(2, 5),
        spin: random(0, Math.PI),
        turn: random(-0.15, 0.15),
        size: random(6, 12),
        color: pick(COLORS),
      }));
    case 'candy':
      // A burst from the middle, falling back down.
      return Array.from({ length: 48 }, () => {
        const angle = random(0, Math.PI * 2);
        const speed = random(4, 12);
        return {
          ...base,
          x: width / 2,
          y: height * 0.45,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 4,
          turn: random(-0.2, 0.2),
          size: random(22, 34),
          text: pick(CANDY),
        };
      });
    case 'season':
      return Array.from({ length: 60 }, () => ({
        ...base,
        x: random(0, width),
        y: random(-height, -20),
        vx: random(-0.8, 0.8),
        vy: random(0.8, 2.2),
        turn: random(-0.03, 0.03),
        size: random(16, 28),
        text: pick(show.pieces),
      }));
    case 'fireworks':
    case 'matrix':
      return [];
  }
}

/** One firework: sparks out from a point, slowing and fading. */
function rocket(width: number, height: number): Piece[] {
  const x = random(width * 0.15, width * 0.85);
  const y = random(height * 0.15, height * 0.5);
  const color = pick(COLORS);
  return Array.from({ length: 70 }, () => {
    const angle = random(0, Math.PI * 2);
    const speed = random(1.5, 6);
    return {
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      spin: 0,
      turn: 0,
      size: random(2, 3.5),
      color,
      life: random(50, 80),
      age: 0,
    };
  });
}

/**
 * The particle surprises, on one canvas over everything for a few seconds: confetti, a piñata's
 * candy, the season falling, fireworks and a rain of green letters.
 */
export function Particles({ show, onDone }: { show: ParticleShow; onDone: () => void }) {
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
    let pieces = start(show, width, height);
    // The matrix's columns: a letter each, falling at its own pace.
    const columns =
      show.kind === 'matrix'
        ? Array.from({ length: Math.ceil(width / 16) }, (_, index) => ({
            x: index * 16,
            y: random(-height, 0),
            speed: random(4, 9),
            text: pick(show.words.length ? show.words : ['pecklist']),
            at: 0,
          }))
        : [];
    const began = performance.now();
    let frame = 0;
    let nextRocket = 0;
    const draw = (now: number) => {
      const elapsed = now - began;
      if (show.kind === 'matrix') {
        context.fillStyle = 'rgba(0, 0, 0, 0.12)';
        context.fillRect(0, 0, width, height);
        context.font = '15px monospace';
        context.fillStyle = '#3CFF6B';
        for (const column of columns) {
          context.fillText(column.text[column.at % column.text.length] ?? '', column.x, column.y);
          column.y += column.speed;
          column.at += 1;
          if (column.y > height + 20) {
            column.y = random(-200, 0);
            column.text = pick(show.words.length ? show.words : ['pecklist']);
          }
        }
      } else {
        context.clearRect(0, 0, width, height);
        if (show.kind === 'fireworks' && elapsed < LENGTH.fireworks - 1200 && now >= nextRocket) {
          pieces = pieces.concat(rocket(width, height));
          nextRocket = now + random(350, 650);
        }
        for (const piece of pieces) {
          piece.age += 1;
          piece.x += piece.vx;
          piece.y += piece.vy;
          piece.spin += piece.turn;
          if (show.kind === 'candy') piece.vy += 0.35;
          if (show.kind === 'fireworks') {
            piece.vx *= 0.97;
            piece.vy = piece.vy * 0.97 + 0.05;
          }
          if (show.kind === 'season') piece.x += Math.sin((piece.y + piece.size * 40) / 60) * 0.6;
          context.save();
          context.globalAlpha = Number.isFinite(piece.life)
            ? Math.max(0, 1 - piece.age / piece.life)
            : 1;
          context.translate(piece.x, piece.y);
          context.rotate(piece.spin);
          if (piece.text) {
            context.font = `${piece.size}px serif`;
            context.textAlign = 'center';
            context.fillText(piece.text, 0, 0);
          } else if (show.kind === 'fireworks') {
            context.fillStyle = piece.color;
            context.beginPath();
            context.arc(0, 0, piece.size, 0, Math.PI * 2);
            context.fill();
          } else {
            context.fillStyle = piece.color;
            context.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
          }
          context.restore();
        }
        pieces = pieces.filter((piece) => piece.age < piece.life && piece.y < height + 60);
      }
      if (elapsed < LENGTH[show.kind]) frame = requestAnimationFrame(draw);
      else onDone();
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [show, onDone]);
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
