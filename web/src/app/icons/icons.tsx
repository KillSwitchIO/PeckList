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

/** Add: a plus. */
export function PlusIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <path strokeWidth={2.25} d="M12 5v14M5 12h14" />
    </PunchIcon>
  );
}

/** Remove or close: an x. */
export function CloseIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <path strokeWidth={2.25} d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </PunchIcon>
  );
}

/** Won't do: a circle struck through. */
export function WontDoIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M6.4 6.4l11.2 11.2" />
    </PunchIcon>
  );
}

/** Reopen: an arrow turning back. */
export function ReopenIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9" />
      <path d="M4.5 4.5V9H9" />
    </PunchIcon>
  );
}

/** Progress: a ring with a filled quarter. */
export function ProgressIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 8 8h-8z" fill="currentColor" />
    </PunchIcon>
  );
}

/** Back: a chevron pointing left. */
export function ChevronLeftIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <path d="M14.5 7l-5 5 5 5" />
    </PunchIcon>
  );
}

/** Complete on a date: a calendar page with a check. */
export function CalendarCheckIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <rect x="4" y="5" width="16" height="15" rx="3" />
      <path d="M4 9.5h16M9 14.5l2 2 4-4" />
    </PunchIcon>
  );
}

/** Numbered list: 1 2 3 beside three lines. */
export function NumberedListIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <path d="M10 6.5h10M10 12h10M10 17.5h10" />
      <g
        fill="currentColor"
        stroke="none"
        fontSize={6.5}
        fontWeight={800}
        fontFamily="system-ui, sans-serif"
        textAnchor="middle"
      >
        <text x="5" y="8.8">
          1
        </text>
        <text x="5" y="14.3">
          2
        </text>
        <text x="5" y="19.8">
          3
        </text>
      </g>
    </PunchIcon>
  );
}

/** Quote: two quotation marks. */
export function QuoteIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <path d="M5 17.5c2.4-1 3.5-3.1 3.5-6.2V7H5v4.3h3.5M14 17.5c2.4-1 3.5-3.1 3.5-6.2V7H14v4.3h3.5" />
    </PunchIcon>
  );
}

/** Divider: a line between two faint ones. */
export function DividerIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <path d="M4 12h16" />
      <path d="M7 6.5h10M7 17.5h10" strokeOpacity={0.45} />
    </PunchIcon>
  );
}

/** Shown: an open eye. */
export function EyeIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </PunchIcon>
  );
}

/** Hidden: an eye struck through. */
export function EyeOffIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <path d="M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.6 6.6C3.9 8.3 2.5 12 2.5 12S6 18.5 12 18.5c1.9 0 3.5-.6 4.9-1.4" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M4 4l16 16" />
    </PunchIcon>
  );
}

/** Drag to reorder: two columns of dots. */
export function DragHandleIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <path strokeWidth={2.6} d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" />
    </PunchIcon>
  );
}

/** A small chevron pointing down (a group that is open). */
export function ChevronDownIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <path d="M7 9.5l5 5 5-5" />
    </PunchIcon>
  );
}

/** A small chevron pointing right (a group that is closed). */
export function ChevronRightIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <path d="M9.5 7l5 5-5 5" />
    </PunchIcon>
  );
}

/** A saved filter: a funnel. */
export function FilterIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <path d="M4 5.5h16l-6.2 7.3v5.4l-3.6 1.8v-7.2z" />
    </PunchIcon>
  );
}

/** Edit: a pencil. */
export function EditIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <path d="M14.5 5.5l4 4M4.5 19.5l1-4.5L16 4.5a1.4 1.4 0 0 1 2 0l1.5 1.5a1.4 1.4 0 0 1 0 2L9 18.5z" />
    </PunchIcon>
  );
}

/** Delete: a bin. */
export function DeleteIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <path d="M4.5 7h15M10 7V5h4v2M6.5 7l.8 11.2A2 2 0 0 0 9.3 20h5.4a2 2 0 0 0 2-1.8L17.5 7M10 11v5M14 11v5" />
    </PunchIcon>
  );
}

/** More actions: three dots. */
export function MoreIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <path strokeWidth={2.8} d="M6 12h.01M12 12h.01M18 12h.01" />
    </PunchIcon>
  );
}

/** Pin to the top of the sidebar: a pushpin. `filled` when pinned. */
export function PinIcon({ filled = false, ...props }: SvgIconProps & { filled?: boolean }) {
  return (
    <PunchIcon {...props}>
      <path d="M9 4.5h6l-1 5 3 3v1.5H7V12.5l3-3z" {...(filled ? { fill: 'currentColor' } : {})} />
      <path d="M12 14v6" />
    </PunchIcon>
  );
}

/** Unpin: a pushpin struck through. */
export function PinOffIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <path d="M9 4.5h6l-1 5 3 3v1.5H7V12.5l3-3z" />
      <path d="M12 14v6M4 4l16 16" />
    </PunchIcon>
  );
}

/** Due: an hourglass (a deadline; the flag means priority). */
export function DueIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <path d="M7 3.5h10M7 20.5h10" />
      <path d="M8 3.5v2c0 2.6 4 4.2 4 6.5 0-2.3 4-3.9 4-6.5v-2M8 20.5v-2c0-2.6 4-4.2 4-6.5 0 2.3 4 3.9 4 6.5v2" />
    </PunchIcon>
  );
}

/** Synced: a cloud with a check. */
export function CloudDoneIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <path d="M7 18.5a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4.5 4.5 0 0 1-.5 9z" />
      <path d="M9.5 13.8l1.8 1.7 3.4-3.5" />
    </PunchIcon>
  );
}

/** Syncing: a cloud with arrows going round. */
export function CloudSyncIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <path d="M7 18.5a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4.5 4.5 0 0 1-.5 9z" />
      <path d="M9.6 13.6a2.5 2.5 0 0 1 4.3-1.3M14.4 14.6a2.5 2.5 0 0 1-4.3 1.3M13.9 10.9v1.4h-1.4M10.1 17.1v-1.4h1.4" />
    </PunchIcon>
  );
}

/** Offline: a cloud struck through. */
export function CloudOffIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <path d="M9.2 6.2A6 6 0 0 1 18 9.5a4.5 4.5 0 0 1 2 8M16.5 18.5H7a4.5 4.5 0 0 1-1.4-8.78" />
      <path d="M3.5 3.5l17 17" />
    </PunchIcon>
  );
}

/** A sync problem: a cloud with an exclamation mark. */
export function CloudAlertIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <path d="M7 18.5a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4.5 4.5 0 0 1-.5 9z" />
      <path d="M12 11v3" />
      <path d="M12 16.2v.1" />
    </PunchIcon>
  );
}

/** An account: a person. */
export function AccountIcon(props: SvgIconProps) {
  return (
    <PunchIcon {...props}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 19.5a7 7 0 0 1 14 0" />
    </PunchIcon>
  );
}
