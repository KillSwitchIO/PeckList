/** A local day and, when the text gave one, a time: `{ date: 'YYYY-MM-DD', time: 'HH:mm' | null }`. */
export interface ParsedMoment {
  date: string;
  time: string | null;
}

/** A date (or a range) found in text, with where it sits. */
export interface DateMatch {
  /** Where the date text starts in the input, and how long it is */
  index: number;
  length: number;
  start: ParsedMoment;
  end: ParsedMoment | null;
}

/**
 * Finds dates in free text, relative to a reference moment, for quick add (PL-022): "tomorrow
 * 3pm", "next fri", "oct 28 to oct 30", "9-11am". Dates in the past move forward (a bare "monday"
 * is the next one). Swap the library behind it by adding an adapter that passes
 * `adapters/dateParser.contract.ts`.
 */
export interface DateParser {
  find(text: string, reference: Date): DateMatch[];
}
