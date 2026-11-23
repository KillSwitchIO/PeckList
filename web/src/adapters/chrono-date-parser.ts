// English always; another language's chrono comes in only when the app speaks it (chrono-locales.ts),
// since the whole library with every locale is several times larger.
import * as english from 'chrono-node/en';
import type {
  Chrono,
  ParsedComponents,
  ParsedResult,
  Parser,
  ParsingComponents,
} from 'chrono-node';
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

/** A language's chrono, as `chrono-node/de` and the others export it. */
export interface ChronoLocale {
  language: string;
  casual: Chrono;
}

/** What chrono misses in a language, as regular expression sources. */
interface Mending {
  /** "the day after tomorrow", which chrono reads as tomorrow alone */
  dayAfterTomorrow?: string;
  /** A word just before a date that belongs to it ("el viernes", "le 12 décembre") */
  lead?: string;
  /** The words joining the two days of a range ("lunes al viernes", "Montag bis Freitag"); a dash always does */
  join?: string;
  /** Words after a time: afternoon or evening ("a las 3 de la tarde"), morning, or the hour's own word ("à 15 heures") */
  after?: { pm: string; am: string; word?: string };
  /** Of `after.pm`, the words that make 12 midnight rather than noon ("a las 12 de la noche"): the day's last minute, 23:59, so a deadline stays on that day */
  midnight?: string;
  /** A part of the day after a date with no time ("morgen früh", "el lunes por la noche"): it goes with the date, which keeps no time, as "tomorrow morning" does */
  dayPart?: string;
  /** "next week", which chrono does not read in this language: a week on, as English chrono reads it */
  nextWeek?: string;
}

const MENDING: Readonly<Record<string, Mending>> = {
  de: {
    lead: 'vom|von',
    join: 'bis',
    dayPart: String.raw`fr[üu]h|morgens|vormittags?|mittags?|nachmittags?|abends?|nachts?|am\s+(?:morgen|vormittag|mittag|nachmittag|abend)`,
  },
  es: {
    dayAfterTomorrow: String.raw`pasado\s+ma[ñn]ana`,
    lead: 'el|del|de|a',
    join: String.raw`al|a|hasta(?:\s+el)?`,
    after: {
      pm: String.raw`(?:de|por)\s+la\s+(?:tarde|noche)|del\s+mediod[ií]a`,
      am: String.raw`(?:de|por)\s+la\s+(?:ma[ñn]ana|madrugada)`,
    },
    midnight: String.raw`(?:de|por)\s+la\s+noche`,
    dayPart: String.raw`(?:por|en)\s+la\s+(?:ma[ñn]ana|tarde|noche)`,
    nextWeek: String.raw`(?:la\s+)?(?:pr[oó]xima|siguiente)\s+semana|la\s+semana\s+(?:que\s+viene|pr[oó]xima|siguiente)`,
  },
  fr: {
    dayAfterTomorrow: String.raw`apr[eè]s[-\s]?demain`,
    lead: 'le|du',
    join: String.raw`au|jusqu'au`,
    after: {
      pm: String.raw`de\s+l['’]apr[eè]s-midi|du\s+soir`,
      am: String.raw`du\s+matin`,
      word: 'heures?',
    },
  },
};

/**
 * Words that name a day some days on from the reference: "pasado mañana" (two, as chrono's own
 * "mañana" is one) and "la próxima semana" (seven, as English chrono reads "next week").
 */
function daysOn(source: string, days: number): Parser {
  return {
    pattern: () => new RegExp(String.raw`(^|\s)(${source})(?=$|[\s,.;!?])`, 'i'),
    extract: (context, match) => {
      const day = new Date(context.refDate);
      day.setDate(day.getDate() + days);
      return context.createParsingResult(match.index! + match[1]!.length, match[2]!, {
        year: day.getFullYear(),
        month: day.getMonth() + 1,
        day: day.getDate(),
      });
    },
  };
}

/** One date chrono found, as this adapter works on it. */
interface Found {
  index: number;
  text: string;
  start: ParsedComponents;
  end: ParsedComponents | undefined;
}

const found = (result: ParsedResult): Found => ({
  index: result.index,
  text: result.text,
  start: result.start,
  end: result.end,
});

const dayOf = (component: ParsedComponents) =>
  component.get('year')! * 10_000 + component.get('month')! * 100 + component.get('day')!;

const timed = (each: Found) =>
  each.start.isCertain('hour') || (each.end?.isCertain('hour') ?? false);

/** A language's chrono, mended where it falls short (MENDING). */
function ownReader(locale: ChronoLocale) {
  const mending = MENDING[locale.language] ?? {};
  const chrono = locale.casual.clone();
  if (mending.dayAfterTomorrow) chrono.parsers.unshift(daysOn(mending.dayAfterTomorrow, 2));
  if (mending.nextWeek) chrono.parsers.unshift(daysOn(mending.nextWeek, 7));
  const midnight = mending.midnight
    ? new RegExp(String.raw`^\s+(?:${mending.midnight})`, 'i')
    : null;
  const dayPart = mending.dayPart
    ? new RegExp(String.raw`^\s+(?:${mending.dayPart})(?=$|[\s,.;!?])`, 'i')
    : null;
  const words = mending.join ? `|\\s+(?:${mending.join})\\s+` : '';
  const between = new RegExp(String.raw`^(?:\s*[-–]\s*${words})$`, 'i');
  const joins = new RegExp(String.raw`\s*[-–]\s*${words}`, 'gi');
  const lead = mending.lead ? new RegExp(String.raw`(^|\s)(?:${mending.lead})\s+$`, 'i') : null;
  const after = mending.after
    ? new RegExp(
        String.raw`^\s+(?:(${mending.after.pm})|(${mending.after.am})` +
          (mending.after.word ? `|(?:${mending.after.word})` : '') +
          String.raw`)(?=$|[\s,.;!?])`,
        'i',
      )
    : null;

  /** The first date in `text` after `after`'s day: the end of a range. */
  const endAfter = (text: string, after: ParsedComponents): ParsedComponents | undefined => {
    const from = new Date(after.get('year')!, after.get('month')! - 1, after.get('day')!, 12);
    const next = chrono.parse(text, from, { forwardDate: true })[0];
    return next && !next.end && dayOf(next.start) > dayOf(after) ? next.start : undefined;
  };

  return (text: string, reference: Date): Found[] => {
    const mended: Found[] = [];
    for (const each of chrono.parse(text, reference, { forwardDate: true }).map(found)) {
      const previous = mended.at(-1);
      // "del lunes al viernes": two days with a range word between them are one range.
      if (
        previous &&
        !previous.end &&
        !each.end &&
        !timed(previous) &&
        !timed(each) &&
        between.test(` ${text.slice(previous.index + previous.text.length, each.index)} `)
      ) {
        const end = endAfter(each.text, previous.start);
        if (end) {
          previous.text = text.slice(previous.index, each.index + each.text.length);
          previous.end = end;
          continue;
        }
      }
      // "Montag bis Freitag": chrono gives both ends the first day, so the second is read again.
      if (each.end && !timed(each) && dayOf(each.end) === dayOf(each.start)) {
        const last = [...each.text.matchAll(joins)].at(-1);
        if (last) {
          const end = endAfter(each.text.slice(last.index + last[0].length), each.start);
          if (end) each.end = end;
        }
      }
      mended.push(each);
    }
    // "a las 3 de la tarde" is 15:00, and its words go with the time; chrono reads "tarde" (or
    // "mañana", tomorrow) on its own, which this time now takes in.
    for (let at = 0; after && at < mended.length; at++) {
      const each = mended[at]!;
      if (each.end || !each.start.isCertain('hour')) continue;
      const said = after.exec(text.slice(each.index + each.text.length));
      if (!said) continue;
      const hour = each.start.get('hour')!;
      const start = each.start as ParsingComponents;
      if (said[1] && hour < 12) start.assign('hour', hour + 12);
      if (said[2] && hour === 12) start.assign('hour', 0);
      if (said[1] && hour === 12 && midnight?.test(said[0])) {
        // The day's last minute, 23:59, so a deadline stays on that day.
        start.assign('hour', 23);
        start.assign('minute', 59);
      }
      each.text += said[0];
      const end = each.index + each.text.length;
      while (mended[at + 1] && mended[at + 1]!.index < end) mended.splice(at + 1, 1);
    }
    // "morgen früh", "el lunes por la noche": the part of the day goes with the date, which keeps
    // no time ("tomorrow morning" has none either). chrono reads "tarde" or "noche" on its own as
    // today, and the "Fr" of "früh" as Friday; those go.
    for (let at = 0; dayPart && at < mended.length; at++) {
      const each = mended[at]!;
      if (each.end || timed(each)) continue;
      const said = dayPart.exec(text.slice(each.index + each.text.length));
      if (!said) continue;
      each.text += said[0];
      const end = each.index + each.text.length;
      while (mended[at + 1] && mended[at + 1]!.index < end) mended.splice(at + 1, 1);
    }
    // "el viernes", "le 12 décembre": the article goes with the date, out of the title.
    if (lead) {
      for (const each of mended) {
        const before = lead.exec(text.slice(0, each.index));
        if (!before) continue;
        const at = before.index + before[1]!.length;
        each.text = text.slice(at, each.index + each.text.length);
        each.index = at;
      }
    }
    return mended;
  };
}

/**
 * Whether a match sits inside a word: chrono's word edges miss letters outside ASCII, so German
 * chrono reads the "Fr" of "Frühstück" as Friday, and English the "sat" of "Cafésat".
 */
const LETTER = /\p{L}/u;
const inWord = (text: string, each: Found) =>
  LETTER.test(text.charAt(each.index - 1)) ||
  LETTER.test(text.charAt(each.index + each.text.length));

const englishReader = (text: string, reference: Date): Found[] =>
  english.casual.parse(text, reference, { forwardDate: true }).map(found);

/**
 * Both readings together: of two dates that overlap the longer wins, so a German line reads
 * "morgen 15 Uhr" and still "tomorrow 3pm", where German chrono sees only "3pm". On a tie the one
 * that names its day wins ("oct 1" is October 1st, not Spanish chrono's October 2001), then the
 * language's own ("12/11" is the 12th of November in Spanish).
 */
function together(own: Found[], other: Found[]): Found[] {
  const named = (each: Found) => (each.start.isCertain('day') ? 1 : 0);
  const ranked = [
    ...own.map((each, rank) => ({ each, rank })),
    ...other.map((each, rank) => ({ each, rank: own.length + rank })),
  ].sort(
    (a, b) =>
      b.each.text.length - a.each.text.length || named(b.each) - named(a.each) || a.rank - b.rank,
  );
  const kept: Found[] = [];
  for (const { each } of ranked) {
    const end = each.index + each.text.length;
    if (kept.some((taken) => each.index < taken.index + taken.text.length && taken.index < end)) {
      continue;
    }
    kept.push(each);
  }
  return kept.sort((a, b) => a.index - b.index);
}

/**
 * The DateParser port on chrono-node, casual: "tomorrow", "next fri", "in 3 days". With a locale,
 * its own words as well ("morgen 15 Uhr", "mañana a las 3", "demain 15h"), English still read.
 */
export function createChronoDateParser(locale?: ChronoLocale): DateParser {
  const own = locale && locale.language !== 'en' ? ownReader(locale) : null;
  const join = locale ? MENDING[locale.language]?.join : undefined;
  // A match ending in a range word that joined nothing is not a date, so its words stay in the
  // title: chrono-es takes "de 3 a" in "Clase de 3 a 5", and English "3 a" as 3 a.m. (Dev 1).
  const dangling = join ? new RegExp(String.raw`\s(?:${join})$`, 'i') : null;
  return {
    find(text, reference) {
      const outside = (each: Found) => !inWord(text, each);
      const read = englishReader(text, reference).filter(outside);
      const dates = (own ? together(own(text, reference).filter(outside), read) : read).filter(
        (each) => !dangling?.test(each.text),
      );
      return dates.map((each): DateMatch => {
        const back = yearsBack(each.start, each.end, reference);
        return {
          index: each.index,
          length: each.text.length,
          start: moment(each.start, back),
          end: each.end ? moment(each.end, back) : null,
        };
      });
    },
  };
}
