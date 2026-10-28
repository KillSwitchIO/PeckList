import { Box, useTheme } from '@mui/material';

const PURPLE = '#4B2A8A';
const GREY = '#A8A6A3';
const SIZE = 72;

/** Punchlist's checklist logo (public/icon.svg), in the given colors. */
function Logo({ tile, mark }: { tile: string; mark: string }) {
  return (
    <svg viewBox="0 0 64 64" width={SIZE} height={SIZE} aria-hidden>
      <rect width="64" height="64" rx="14" fill={tile} />
      <rect x="14" y="15" width="10" height="10" rx="3" fill={mark} />
      <path
        d="M16.5 20l2 2 3.5-4"
        fill="none"
        stroke={tile}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="28" y="18" width="22" height="4" rx="2" fill={mark} />
      <rect x="14" y="29" width="10" height="10" rx="3" fill="none" stroke={mark} strokeWidth="2" />
      <rect x="28" y="32" width="18" height="4" rx="2" fill={mark} opacity=".7" />
      <rect x="14" y="43" width="10" height="10" rx="3" fill="none" stroke={mark} strokeWidth="2" />
      <rect x="28" y="46" width="14" height="4" rx="2" fill={mark} opacity=".7" />
    </svg>
  );
}

/** The other side: one big check, drawn in as it turns to face you. */
function Check({ tile, mark }: { tile: string; mark: string }) {
  return (
    <svg viewBox="0 0 64 64" width={SIZE} height={SIZE} aria-hidden>
      <rect width="64" height="64" rx="14" fill={tile} />
      <path
        className="pl-empty-check"
        d="M18 33.5l9.5 9.5L47 22.5"
        fill="none"
        stroke={mark}
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
      />
    </svg>
  );
}

/**
 * The mark over an empty view: Punchlist's logo for a moment, then it flips round to a big check
 * that draws itself in with a little pop: all done here. The logo's own colors, turned round in a
 * light theme as the favicon is. With reduced motion asked for, just the check.
 */
export function EmptyMark() {
  const theme = useTheme();
  const dark = theme.palette.mode === 'dark';
  const tile = dark ? PURPLE : GREY;
  const mark = dark ? GREY : PURPLE;
  return (
    <Box
      aria-hidden
      sx={{
        width: SIZE,
        height: SIZE,
        perspective: 400,
        '& .pl-empty-card': {
          position: 'relative',
          width: SIZE,
          height: SIZE,
          transformStyle: 'preserve-3d',
          animation: 'pl-empty-flip 0.7s 0.9s cubic-bezier(0.5, -0.3, 0.3, 1.4) both',
        },
        '& .pl-empty-face': {
          position: 'absolute',
          inset: 0,
          backfaceVisibility: 'hidden',
          borderRadius: '22%',
          boxShadow: 3,
          lineHeight: 0,
        },
        '& .pl-empty-back': { transform: 'rotateY(180deg)' },
        '& .pl-empty-check': {
          strokeDasharray: 1,
          strokeDashoffset: 1,
          animation: 'pl-empty-draw 0.45s 1.45s ease-out forwards',
        },
        '& .pl-empty-back svg': { animation: 'pl-empty-pop 0.35s 1.85s ease-out' },
        '@keyframes pl-empty-flip': {
          from: { transform: 'rotateY(0deg)' },
          to: { transform: 'rotateY(180deg)' },
        },
        '@keyframes pl-empty-draw': { to: { strokeDashoffset: 0 } },
        '@keyframes pl-empty-pop': { '50%': { transform: 'scale(1.12)' } },
        '@media (prefers-reduced-motion: reduce)': {
          '& .pl-empty-card': { animation: 'none', transform: 'rotateY(180deg)' },
          '& .pl-empty-check': { animation: 'none', strokeDashoffset: 0 },
          '& .pl-empty-back svg': { animation: 'none' },
        },
      }}
    >
      <div className="pl-empty-card">
        <div className="pl-empty-face">
          <Logo tile={tile} mark={mark} />
        </div>
        <div className="pl-empty-face pl-empty-back">
          <Check tile={tile} mark={mark} />
        </div>
      </div>
    </Box>
  );
}
