// English only: the whole library with every locale is several times larger.
import * as chrono from 'chrono-node/en';
import type { ParsedComponents } from 'chrono-node';
import type { DateMatch, DateParser, ParsedMoment } from '../ports/dateParser.ts';

const two = (n: number) => String(n).padStart(2, '0');

/**
 * Years to take back off chrono's for one match: 1 when chrono moved a date with no year of its own
 * to next year although it (or, for a range, its end) still falls on or after the reference's day.
 * chrono moves a date already past to next year (forwardDate), but it counts a date with no time as
 * noon, or the time said: so after noon, today's own date ("nov 19" on Nov 19) went to next year
 * (0.14.0, through the API). A range moves as one, so "nov 18 - nov 21" typed on Nov 19 stays this
 * year with its ends in order (Dev 2's review), and only a range wholly before today moves on.
 */
function yearsBack(
  start: ParsedComponents,
  end: ParsedComponents | undefined,
  reference: Date,
): number {
  if (start.isCertain('year') || start.get('year')! <= reference.getFullYear()) return 0;
  const last = end && !end.isCertain('year') ? end : start;
  const back = new Date(last.get('year')! - 1, last.get('month')! - 1, last.get('day')!);
  const today = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  return back >= today ? 1 : 0;
}

function moment(component: ParsedComponents, back: number): ParsedMoment {
  const year = component.get('year')! - (component.isCertain('year') ? 0 : back);
  const date = `${year}-${two(component.get('month')!)}-${two(component.get('day')!)}`;
  // A time only when the text said one ("3pm", "15:00", "noon"), not chrono's implied midnight.
  const time = component.isCertain('hour')
    ? `${two(component.get('hour')!)}:${two(component.get('minute') ?? 0)}`
    : null;
  return { date, time };
}

/** The DateParser port on chrono-node (English, casual: "tomorrow", "next fri", "in 3 days"). */
export function createChronoDateParser(): DateParser {
  return {
    find(text, reference) {
      return chrono.casual
        .parse(text, reference, { forwardDate: true })
        .map((result): DateMatch => {
          const back = yearsBack(result.start, result.end, reference);
          return {
            index: result.index,
            length: result.text.length,
            start: moment(result.start, back),
            end: result.end ? moment(result.end, back) : null,
          };
        });
    },
  };
}
