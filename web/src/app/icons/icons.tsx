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

// Text formatting, for the notes toolbar.

/** Bold: a heavy B. */
export function BoldIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <path
        strokeWidth={2.4}
        d="M7.5 5H13a3.5 3.5 0 0 1 0 7H7.5zM7.5 12H14a3.5 3.5 0 0 1 0 7H7.5z"
      />
    </PunchIcon>
  );
}

/** Italic: a slanted stem between two serifs. */
export function ItalicIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <path d="M10.5 5H17M7 19h6.5M14 5l-4 14" />
    </PunchIcon>
  );
}

/** Strikethrough: an S crossed by a line. */
export function StrikeIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <path d="M4 12h16" />
      <path d="M16.5 7.5C16 6 14.4 5 12 5 9.4 5 7.6 6.3 7.6 8.2c0 1.4.9 2.3 2.4 2.9" />
      <path d="M15.6 14.4c.6.5.9 1.1.9 1.9 0 1.6-1.9 2.7-4.5 2.7-2.5 0-4.2-.9-4.8-2.5" />
    </PunchIcon>
  );
}

/** Inline code: angle brackets. */
export function CodeIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <path d="M9 7l-5 5 5 5M15 7l5 5-5 5" />
    </PunchIcon>
  );
}

/** Heading: an H. */
export function HeadingIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <path d="M6.5 5v14M17.5 5v14M6.5 12h11" />
    </PunchIcon>
  );
}

/** Bulleted list: three dots and three lines. */
export function BulletListIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <path d="M10 6.5h10M10 12h10M10 17.5h10" />
      <path strokeWidth={2.6} d="M5 6.5h.01M5 12h.01M5 17.5h.01" />
    </PunchIcon>
  );
}

/** Checklist: a ticked box and an empty one, each with a line. */
export function ChecklistIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <rect x="3.5" y="4" width="6" height="6" rx="1.5" />
      <path d="M5 7.1l1.2 1.2 2-2.3" />
      <rect x="3.5" y="14" width="6" height="6" rx="1.5" />
      <path d="M13 7h7M13 17h7" />
    </PunchIcon>
  );
}

/** Link: two chain links. */
export function LinkIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <path d="M10 13.5a4 4 0 0 0 5.7.4l2.9-2.9a4 4 0 0 0-5.7-5.7l-1.1 1.1" />
      <path d="M14 10.5a4 4 0 0 0-5.7-.4l-2.9 2.9a4 4 0 0 0 5.7 5.7l1.1-1.1" />
    </PunchIcon>
  );
}

// Panels and pickers.

/** Full screen: arrows out to two corners. */
export function ExpandIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <path d="M14 4h6v6M20 4l-6.5 6.5M10 20H4v-6M4 20l6.5-6.5" />
    </PunchIcon>
  );
}

/** Leave full screen: arrows in from two corners. */
export function CollapseIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <path d="M20 4l-6 6M14 5v5h5M4 20l6-6M10 19v-5H5" />
    </PunchIcon>
  );
}

/** Priority: a flag on a pole. `filled` fills the cloth (a priority is set). */
export function FlagIcon({ filled = false, ...props }: SvgIconProps & { filled?: boolean }) {
  return (
    <PunchIcon {...props}>
      <path d="M5.5 21V4" />
      <path
        d="M5.5 4.5c2.8-1.6 5.2 1.6 8 0s4.2-.9 5 -.4v8.6c-.8-.5-2.2-1.2-5 .4s-5.2-1.6-8 0"
        {...(filled ? { fill: 'currentColor' } : {})}
      />
    </PunchIcon>
  );
}

/** A small chevron pointing up (a menu that opens upward). */
export function ChevronUpIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <path d="M7 14.5l5-5 5 5" />
    </PunchIcon>
  );
}

/** A check mark (the chosen item in a menu). */
export function CheckIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </PunchIcon>
  );
}

/** Mess Drawer: an inbox tray. */
export function TrayIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <path d="M4 13.5l2.1-6.6A2.5 2.5 0 0 1 8.5 5h7a2.5 2.5 0 0 1 2.4 1.9l2.1 6.6V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M4 13.5h4.2l1.3 2h5l1.3-2H20" />
    </PunchIcon>
  );
}
