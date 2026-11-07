// Where everything sits in the Year view's one long run of months (spec: PL-093). Every year has
// the same height, so a position is worked out, never measured, and months coming into view never
// move the ones already there.

/** How many years it runs either way from now: as good as no end, at a height browsers can scroll. */
export const SPAN_YEARS = 100;
const HEADING_PX = 36;
/** The least a row of months may be: below this a day is too small to read or tap. */
const MIN_ROW_PX = 196;
const MIN_ROW_WIDE_PX = 148;

export interface YearLayout {
  firstYear: number;
  columns: number;
  rowsPerYear: number;
  rowHeight: number;
  headingHeight: number;
  /** A year's height: its heading and its rows */
  span: number;
  /** A whole year fits, so it opens and jumps to the year rather than a month */
  yearFits: boolean;
  total: number;
}

/** A row of months in the run. */
export interface YearRow {
  /** `YYYY-MM` of each month in it */
  months: string[];
  top: number;
}

/** A year's heading in the run. */
export interface YearHeading {
  year: number;
  top: number;
}

export function yearLayout(width: number, height: number, firstYear: number): YearLayout {
  // By the room the calendar has, not the window's: the side panel and the menu take from it.
  const columns = width >= 840 ? 4 : width >= 560 ? 3 : 2;
  const rowsPerYear = 12 / columns;
  const least = columns === 4 ? MIN_ROW_WIDE_PX : MIN_ROW_PX;
  const room = height - HEADING_PX;
  const rowHeight = Math.max(least, Math.floor(room / rowsPerYear));
  const yearFits = rowHeight * rowsPerYear <= room;
  // Where a year fits it fills the screen exactly, whatever whole pixels the rows left over.
  const headingHeight = yearFits ? height - rowHeight * rowsPerYear : HEADING_PX;
  const span = headingHeight + rowHeight * rowsPerYear;
  return {
    firstYear,
    columns,
    rowsPerYear,
    rowHeight,
    headingHeight,
    span,
    yearFits,
    total: span * (SPAN_YEARS * 2 + 1),
  };
}

const lastYear = (layout: YearLayout) => layout.firstYear + SPAN_YEARS * 2;
const clampYear = (layout: YearLayout, year: number) =>
  Math.min(lastYear(layout), Math.max(layout.firstYear, year));

/** Where a year's heading is. */
export function yearTop(layout: YearLayout, year: number): number {
  return (clampYear(layout, year) - layout.firstYear) * layout.span;
}

/** Where the row holding a month (`YYYY-MM`) is. */
export function monthTop(layout: YearLayout, month: string): number {
  const row = Math.floor((Number(month.slice(5)) - 1) / layout.columns);
  return yearTop(layout, Number(month.slice(0, 4))) + layout.headingHeight + row * layout.rowHeight;
}

/** Where to scroll to bring a month up: its row, with its year's heading if that is all above it. */
export function goToTop(layout: YearLayout, month: string): number {
  const inFirstRow = Number(month.slice(5)) <= layout.columns;
  return layout.yearFits || inFirstRow
    ? yearTop(layout, Number(month.slice(0, 4)))
    : monthTop(layout, month);
}

/** The year a scroll position is in: the new one once its heading is half past the top. */
export function yearAt(layout: YearLayout, scrollTop: number): number {
  const index = Math.floor((scrollTop + layout.headingHeight / 2) / layout.span);
  return clampYear(layout, layout.firstYear + index);
}

/** The first month of the row at a scroll position. */
export function monthAt(layout: YearLayout, scrollTop: number): string {
  const year = yearAt(layout, scrollTop);
  const into = scrollTop - yearTop(layout, year) - layout.headingHeight;
  const row = Math.max(0, Math.min(layout.rowsPerYear - 1, Math.floor(into / layout.rowHeight)));
  return `${year}-${String(row * layout.columns + 1).padStart(2, '0')}`;
}

/**
 * Where the view stays: a place it was scrolled to (the first month of the row at the top, and how
 * far into that row, so it stays put to the pixel and through a new shape), or a month it was sent to.
 */
export type YearStay = { place: { month: string; into: number } } | { sent: string };

export function stayAt(layout: YearLayout, scrollTop: number): YearStay {
  const month = monthAt(layout, scrollTop);
  return { place: { month, into: (scrollTop - monthTop(layout, month)) / layout.rowHeight } };
}

export function stayTop(layout: YearLayout, stay: YearStay): number {
  return 'sent' in stay
    ? goToTop(layout, stay.sent)
    : monthTop(layout, stay.place.month) + stay.place.into * layout.rowHeight;
}

/** The rows and headings that touch the stretch from `from` to `to`. */
export function yearParts(
  layout: YearLayout,
  from: number,
  to: number,
): { rows: YearRow[]; headings: YearHeading[] } {
  const rows: YearRow[] = [];
  const headings: YearHeading[] = [];
  const first = Math.max(0, Math.floor(from / layout.span));
  const last = Math.min(SPAN_YEARS * 2, Math.floor(to / layout.span));
  for (let index = first; index <= last; index++) {
    const year = layout.firstYear + index;
    const top = index * layout.span;
    if (top + layout.headingHeight > from && top < to) headings.push({ year, top });
    for (let row = 0; row < layout.rowsPerYear; row++) {
      const rowTop = top + layout.headingHeight + row * layout.rowHeight;
      if (rowTop + layout.rowHeight <= from || rowTop >= to) continue;
      rows.push({
        top: rowTop,
        months: Array.from(
          { length: layout.columns },
          (_, column) => `${year}-${String(row * layout.columns + column + 1).padStart(2, '0')}`,
        ),
      });
    }
  }
  return { rows, headings };
}
