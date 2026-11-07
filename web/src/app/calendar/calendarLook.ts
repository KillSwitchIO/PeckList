// What the calendar's views share, so they read as one (spec: PL-093).

/** The line under a row: under Month's weeks and its weekdays, and under a year's last months. */
export const rowRule = { borderBottom: 1, borderColor: 'divider' } as const;

/** A date as a heading: the calendar's own title, and a year's in the Year view. */
export const dateHeading = { fontWeight: 600, fontSize: { xs: 15, sm: 16 } } as const;
