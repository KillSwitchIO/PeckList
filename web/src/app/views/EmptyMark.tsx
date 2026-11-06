import { Box, useTheme } from '@mui/material';
import { useMarkPlays } from './emptyMarkPlays.ts';

const SIZE = 72;

/** The logo's own colors (public/icon.svg, and favicon.svg for the light theme). */
const LOGO = {
  dark: { tile: '#3C5436', mark: '#A6ADA4', wire: '#ECEFEC', eye: '#FFFFFF' },
  light: { tile: '#DCEBD3', mark: '#4D6746', wire: '#476440', eye: '#374E32' },
};

const BIRD_FACETS = [
  '6,42 16,36 22,44',
  '16,36 26,27 30,35',
  '16,36 30,35 22,44',
  '26,27 34,17 30,35',
  '34,17 42,12 41,20',
  '42,12 49,16 41,20',
  '34,17 41,20 30,35',
  '41,20 49,21 46,27',
  '41,20 46,27 30,35',
  '46,27 46,36 30,35',
  '46,36 36,45 30,35',
  '36,45 22,44 30,35',
];

/** PeckList's logo (public/icon.svg): the wireframe bird heading the list. */
function Logo({ tile, mark, wire, eye, size = SIZE }: (typeof LOGO)['dark'] & { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden>
      <rect width="64" height="64" rx="14" fill={tile} />
      <g
        transform="translate(4.9 -0.2) scale(0.52)"
        fill="none"
        stroke={wire}
        strokeWidth="1.5"
        strokeLinejoin="round"
      >
        {BIRD_FACETS.map((points) => (
          <polygon key={points} points={points} />
        ))}
        <polygon fill={mark} points="49,16 58,19 49,21" />
        <circle fill={eye} stroke="none" cx="44" cy="17" r="1.6" />
      </g>
      <rect x="39" y="13" width="16" height="4" rx="2" fill={mark} />
      <rect x="14" y="28" width="10" height="10" rx="3" fill={mark} />
      <path
        d="M16.5 33l2 2 3.5-4"
        fill="none"
        stroke={tile}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="28" y="31" width="18" height="4" rx="2" fill={mark} />
      <rect x="14" y="42" width="10" height="10" rx="3" fill="none" stroke={mark} strokeWidth="2" />
      <rect x="28" y="45" width="14" height="4" rx="2" fill={mark} opacity=".7" />
    </svg>
  );
}

/** PeckList's icon at any size, in the colors of the theme (the sidebar's title). */
export function AppLogo({ size }: { size: number }) {
  const theme = useTheme();
  return <Logo {...LOGO[theme.palette.mode]} size={size} />;
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
 * The mark over an empty view: PeckList's logo for a moment, then it flips round to a big check
 * that draws itself in with a little pop: all done here. The logo's own colors, turned round in a
 * light theme as the favicon is. With reduced motion asked for, just the check.
 */
export function EmptyMark() {
  const theme = useTheme();
  // On arriving, or when the view just emptied; otherwise the check, still (R-FB-152).
  const plays = useMarkPlays();
  const still = {
    '& .pl-empty-card': { animation: 'none', transform: 'rotateY(180deg)' },
    '& .pl-empty-check': { animation: 'none', strokeDashoffset: 0 },
    '& .pl-empty-back svg': { animation: 'none' },
  };
  const colors = LOGO[theme.palette.mode];
  return (
    <Box
      aria-hidden
      data-plays={plays ? 'true' : 'false'}
      data-testid="empty-mark"
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
        '@media (prefers-reduced-motion: reduce)': still,
        ...(plays ? {} : still),
      }}
    >
      <div className="pl-empty-card">
        <div className="pl-empty-face">
          <Logo {...colors} />
        </div>
        <div className="pl-empty-face pl-empty-back">
          <Check tile={colors.tile} mark={colors.mark} />
        </div>
      </div>
    </Box>
  );
}
