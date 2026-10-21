// Punchlist's own icons, drawn here as SVG so they share one look and follow the theme:
// a 24 x 24 grid, 1.75 strokes with round ends and joins, no fills, `currentColor` (so they take
// the text or accent color of where they sit). Add new icons in this style; keep them simple.

import { SvgIcon, type SvgIconProps } from '@mui/material';
import { useId, type ReactNode } from 'react';

const STROKE = 1.75;

function PunchIcon({ children, ...props }: SvgIconProps & { children: ReactNode }) {
  return (
    <SvgIcon {...props}>
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </g>
    </SvgIcon>
  );
}

/** Today: a sun. */
export function SunIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v1.5M12 19.5V21M3 12h1.5M19.5 12H21M5.6 5.6l1.1 1.1M17.3 17.3l1.1 1.1M5.6 18.4l1.1-1.1M17.3 6.7l1.1-1.1" />
    </PunchIcon>
  );
}

/** Tomorrow: the sun coming up over the horizon. */
export function SunriseIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <path d="M7.5 16a4.5 4.5 0 0 1 9 0" />
      <path d="M3 19.5h18" />
      <path d="M12 5v3M4.9 10.4l1.5 1.1M19.1 10.4l-1.5 1.1M9.5 6.5 12 4l2.5 2.5" />
    </PunchIcon>
  );
}

/**
 * A plain calendar page: a rounded square with a header line. `badge` ("+7") is drawn centered
 * in the body below the line.
 */
export function CalendarIcon({ badge, ...props }: SvgIconProps & { badge?: string }) {
  return (
    <PunchIcon {...props}>
      <rect x="4" y="5" width="16" height="15" rx="3" />
      <path d="M4 9.5h16" />
      {badge && (
        <text
          x="12"
          y="14.9"
          textAnchor="middle"
          dominantBaseline="central"
          fill="currentColor"
          stroke="none"
          fontSize={badge.length > 2 ? 6.5 : 7.5}
          fontWeight={800}
          fontFamily="system-ui, sans-serif"
        >
          {badge}
        </text>
      )}
    </PunchIcon>
  );
}

/**
 * Next month: a calendar page with a circled right arrow in its lower right corner. The page is
 * cut away around the circle so the arrow reads cleanly at small sizes.
 */
export function CalendarNextIcon(props: SvgIconProps) {
  const mask = `punch-calendar-next-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <PunchIcon {...props}>
      <defs>
        <mask id={mask}>
          <rect width="24" height="24" fill="white" stroke="none" />
          <circle cx="18" cy="18" r="5.75" fill="black" stroke="none" />
        </mask>
      </defs>
      <g mask={`url(#${mask})`}>
        <rect x="3" y="4" width="16" height="15" rx="3" />
        <path d="M3 8.5h16" />
      </g>
      <circle cx="18" cy="18" r="4.25" />
      <path d="M16 18h4M18.4 16.3 20 18l-1.6 1.7" />
    </PunchIcon>
  );
}
