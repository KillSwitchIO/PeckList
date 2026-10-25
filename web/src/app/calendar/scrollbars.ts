// Scrollbars in the calendar (spec: PL-093). On touch screens there are none: a finger swipes and
// pinches, and a bar there only takes room and is hard to hit. With a mouse a thin one, its room
// kept (scrollbar-gutter) so rows above the scrolling part line up with the columns under them.

/** For a scrolling part of the calendar. */
export const scrolling = {
  scrollbarWidth: 'thin',
  scrollbarGutter: 'stable',
  '@media (pointer: coarse)': {
    scrollbarWidth: 'none',
    '&::-webkit-scrollbar': { display: 'none' },
  },
} as const;

/** For a row above a scrolling part: the same room on the right, so its columns line up. */
export const besideScrolling = {
  overflowY: 'hidden',
  ...scrolling,
} as const;
