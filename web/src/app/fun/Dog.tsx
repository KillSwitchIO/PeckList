import { Box } from '@mui/material';
import { useEffect, useState } from 'react';
import { t } from '../i18n/i18n.ts';

/** How the dog stands at each moment of its visit. */
type Pose = 'walk' | 'sit' | 'curl';
type Phase = 'arriving' | 'sitting' | 'sleeping' | 'waking' | 'leaving';

const WIDTH = 72;
const HEIGHT = 54;
/** Walking pace, pixels a second. */
const PACE = 170;
const FUR = '#D9A066';
const DARK = '#A86B3C';
const NOSE = '#3B2A20';

/** The dog, drawn facing right, in one of its poses. */
function DogPicture({ pose }: { pose: Pose }) {
  if (pose === 'curl') {
    return (
      <svg viewBox="0 0 80 60" width={WIDTH} height={HEIGHT} aria-hidden>
        <g className="pl-dog-breathe">
          {/* Curled up: a round of fur, the tail wrapped round, the head resting on it. */}
          <ellipse cx="38" cy="45" rx="25" ry="12" fill={FUR} />
          <path
            d="M14 46 C 10 56, 40 60, 54 54"
            fill="none"
            stroke={DARK}
            strokeWidth="5"
            strokeLinecap="round"
          />
          <circle cx="57" cy="41" r="9.5" fill={FUR} />
          <ellipse cx="65" cy="45" rx="6" ry="4" fill={FUR} />
          <circle cx="70" cy="44" r="1.8" fill={NOSE} />
          <ellipse cx="53" cy="37" rx="3.5" ry="7" fill={DARK} transform="rotate(-50 53 37)" />
          <path d="M58 40 q 2.5 1.8 5 0" fill="none" stroke={NOSE} strokeWidth="1.3" />
        </g>
      </svg>
    );
  }
  if (pose === 'sit') {
    return (
      <svg viewBox="0 0 80 60" width={WIDTH} height={HEIGHT} aria-hidden>
        <path
          d="M18 50 C 8 50, 6 42, 10 38"
          fill="none"
          stroke={DARK}
          strokeWidth="4"
          strokeLinecap="round"
        />
        <ellipse cx="36" cy="38" rx="16" ry="11" fill={FUR} transform="rotate(-38 36 38)" />
        <circle cx="27" cy="47" r="10" fill={FUR} />
        <rect x="41" y="34" width="5" height="20" rx="2.5" fill={FUR} />
        <rect x="47" y="34" width="5" height="20" rx="2.5" fill={FUR} />
        <circle cx="52" cy="18" r="11" fill={FUR} />
        <ellipse cx="62" cy="21" rx="7" ry="5" fill={FUR} />
        <circle cx="68" cy="19.5" r="2.2" fill={NOSE} />
        <ellipse cx="46" cy="14" rx="4" ry="8" fill={DARK} transform="rotate(-18 46 14)" />
        <circle cx="55" cy="15" r="1.6" fill={NOSE} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 80 60" width={WIDTH} height={HEIGHT} aria-hidden>
      <path
        className="pl-dog-tail"
        d="M15 30 C 8 26, 6 20, 8 15"
        fill="none"
        stroke={DARK}
        strokeWidth="4"
        strokeLinecap="round"
      />
      <rect className="pl-dog-leg-a" x="18" y="38" width="5" height="16" rx="2.5" fill={DARK} />
      <rect className="pl-dog-leg-b" x="44" y="38" width="5" height="16" rx="2.5" fill={DARK} />
      <ellipse cx="34" cy="34" rx="21" ry="11" fill={FUR} />
      <rect className="pl-dog-leg-b" x="24" y="38" width="5" height="16" rx="2.5" fill={FUR} />
      <rect className="pl-dog-leg-a" x="50" y="38" width="5" height="16" rx="2.5" fill={FUR} />
      <circle cx="57" cy="23" r="11" fill={FUR} />
      <ellipse cx="67" cy="26" rx="7" ry="5" fill={FUR} />
      <circle cx="73" cy="24.5" r="2.2" fill={NOSE} />
      <ellipse cx="51" cy="19" rx="4" ry="8" fill={DARK} transform="rotate(-20 51 19)" />
      <circle cx="60" cy="20" r="1.6" fill={NOSE} />
    </svg>
  );
}

/**
 * The dog (R-FB-122): it trots over to the + button, sits on top of it, curls up and sleeps,
 * snoring little z's, until touched; then it gets up and trots off the screen.
 */
export function Dog({ onDone }: { onDone: () => void }) {
  // Where it settles: just above the + button (or the bottom right without one).
  const [spot] = useState(() => {
    const add = document.querySelector<HTMLElement>('button[aria-label="Add a task"]');
    const box = add?.getBoundingClientRect();
    return box
      ? { left: box.left + box.width / 2 - WIDTH / 2, top: box.top - HEIGHT + 6 }
      : { left: window.innerWidth - WIDTH - 24, top: window.innerHeight - 200 };
  });
  const [phase, setPhase] = useState<Phase>('arriving');
  const [x, setX] = useState(-(spot.left + WIDTH + 20));
  const walkMs = (distance: number) => Math.round((Math.abs(distance) / PACE) * 1000);
  const arriveMs = walkMs(spot.left + WIDTH + 20);
  const leaveBy = window.innerWidth - spot.left + 20;

  useEffect(() => {
    // Walk in from the left edge, sit a moment, then curl up.
    const go = requestAnimationFrame(() => setX(0));
    const sit = setTimeout(() => setPhase('sitting'), arriveMs);
    const curl = setTimeout(() => setPhase('sleeping'), arriveMs + 1100);
    return () => {
      cancelAnimationFrame(go);
      clearTimeout(sit);
      clearTimeout(curl);
    };
  }, [arriveMs]);

  useEffect(() => {
    if (phase === 'waking') {
      const timer = setTimeout(() => {
        setPhase('leaving');
        setX(leaveBy);
      }, 500);
      return () => clearTimeout(timer);
    }
    if (phase === 'leaving') {
      const timer = setTimeout(onDone, walkMs(leaveBy) + 100);
      return () => clearTimeout(timer);
    }
  }, [phase, leaveBy, onDone]);

  const pose: Pose =
    phase === 'sitting' || phase === 'waking' ? 'sit' : phase === 'sleeping' ? 'curl' : 'walk';
  const walking = phase === 'arriving' || phase === 'leaving';
  return (
    <Box
      role={phase === 'sleeping' ? 'button' : undefined}
      aria-label={phase === 'sleeping' ? t('fun.dogWake') : undefined}
      aria-hidden={phase === 'sleeping' ? undefined : true}
      onClick={() => phase === 'sleeping' && setPhase('waking')}
      sx={{
        position: 'fixed',
        left: spot.left,
        top: spot.top,
        width: WIDTH,
        height: HEIGHT,
        zIndex: (theme) => theme.zIndex.appBar + 1,
        transform: `translateX(${x}px)`,
        transition: walking
          ? `transform ${phase === 'arriving' ? arriveMs : walkMs(leaveBy)}ms linear`
          : 'none',
        pointerEvents: phase === 'sleeping' ? 'auto' : 'none',
        cursor: 'pointer',
        filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.25))',
        '& .pl-dog-leg-a': walking
          ? { animation: 'pl-dog-step 0.32s ease-in-out infinite alternate' }
          : {},
        '& .pl-dog-leg-b': walking
          ? { animation: 'pl-dog-step 0.32s ease-in-out infinite alternate-reverse' }
          : {},
        '& rect': { transformBox: 'fill-box', transformOrigin: 'top center' },
        '@keyframes pl-dog-step': {
          from: { transform: 'rotate(22deg)' },
          to: { transform: 'rotate(-22deg)' },
        },
        '& .pl-dog-tail': {
          transformBox: 'fill-box',
          transformOrigin: 'bottom right',
          animation: 'pl-dog-wag 0.25s ease-in-out infinite alternate',
        },
        '@keyframes pl-dog-wag': { to: { transform: 'rotate(-20deg)' } },
        '& .pl-dog-breathe': {
          transformBox: 'fill-box',
          transformOrigin: 'bottom center',
          animation: 'pl-dog-breathe 2.4s ease-in-out infinite',
        },
        '@keyframes pl-dog-breathe': { '50%': { transform: 'scaleY(1.05)' } },
        // Its snores, drifting up while it sleeps.
        '& .pl-dog-z': {
          position: 'absolute',
          right: 2,
          top: 8,
          fontSize: 13,
          fontWeight: 700,
          color: 'text.secondary',
          opacity: 0,
          animation: 'pl-dog-z 2.4s ease-out infinite',
        },
        '& .pl-dog-z:nth-of-type(2)': { animationDelay: '0.8s' },
        '& .pl-dog-z:nth-of-type(3)': { animationDelay: '1.6s' },
        '@keyframes pl-dog-z': {
          '0%': { opacity: 0, transform: 'translate(0, 0) scale(0.6)' },
          '30%': { opacity: 1 },
          '100%': { opacity: 0, transform: 'translate(12px, -26px) scale(1.2)' },
        },
      }}
    >
      <DogPicture pose={pose} />
      {phase === 'sleeping' && (
        <>
          <span className="pl-dog-z">z</span>
          <span className="pl-dog-z">z</span>
          <span className="pl-dog-z">Z</span>
        </>
      )}
    </Box>
  );
}
