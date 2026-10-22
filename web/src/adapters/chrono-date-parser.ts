// English only: the whole library with every locale is several times larger.
import * as chrono from 'chrono-node/en';
import type { ParsedComponents } from 'chrono-node';
import type { DateMatch, DateParser, ParsedMoment } from '../ports/dateParser.ts';

const two = (n: number) => String(n).padStart(2, '0');

function moment(component: ParsedComponents): ParsedMoment {
  const date = `${component.get('year')}-${two(component.get('month')!)}-${two(component.get('day')!)}`;
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
        .map((result): DateMatch => ({
          index: result.index,
          length: result.text.length,
          start: moment(result.start),
          end: result.end ? moment(result.end) : null,
        }));
    },
  };
}
