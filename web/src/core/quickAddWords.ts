// Quick add's own words in each language it reads (PL-148): the repeat grammar ("every other
// week", "jeden Montag", "cada 2 semanas", "tous les lundis"), the !priority words and the word
// that makes a date the due date. English is always read too, so "every day" and "!high" work
// whatever language the app speaks. Dates themselves come from the DateParser (chrono's locales).
//
// Tags, lists and people are names (#, ^, @), so they need no words of their own.

import type { Priority } from './types.ts';

/** The pieces of "every ..." in one language, each a regular expression source without groups. */
export interface RepeatGrammar {
  /** "every" */
  every: string;
  /** The word for "other" (every other week), read as an interval of 2. */
  other: string;
  /** day, week, month and year, singular and plural */
  units: { day: string; week: string; month: string; year: string };
  /** "weekday": Monday to Friday */
  weekdays: string;
  /** Sunday to Saturday, each with its short forms and plural. */
  days: readonly [string, string, string, string, string, string, string];
  /** What joins days in a list ("mon and thu"), besides a comma. */
  and: string;
  /** The word between "every 2 weeks" and its days ("every 2 weeks on monday"). */
  on: string;
}

export interface QuickAddWords {
  repeat: RepeatGrammar;
  /** !word: its priority (3 high to 0 none), keys in lower case. */
  priority: Readonly<Record<string, Priority>>;
  /** The words before a date that make it the due date ("due by fri"). */
  due: string;
}

const ENGLISH: QuickAddWords = {
  repeat: {
    every: 'every',
    other: 'other',
    units: { day: 'days?', week: 'weeks?', month: 'months?', year: 'years?' },
    weekdays: 'weekdays?',
    days: [
      'sun(?:day)?s?',
      'mon(?:day)?s?',
      'tues?(?:day)?s?',
      'wed(?:nes)?(?:day)?s?',
      'thu(?:rs?)?(?:day)?s?',
      'fri(?:day)?s?',
      'sat(?:ur)?(?:day)?s?',
    ],
    and: 'and|&',
    on: 'on',
  },
  priority: {
    high: 3,
    h: 3,
    '1': 3,
    medium: 2,
    med: 2,
    m: 2,
    '2': 2,
    low: 1,
    l: 1,
    '3': 1,
    none: 0,
    '0': 0,
  },
  due: String.raw`due(?:\s+(?:by|on))?`,
};

const GERMAN: QuickAddWords = {
  repeat: {
    // jeden Tag, jede Woche, jedes Jahr, alle 3 Tage
    every: 'jede[nrs]?|alle',
    // jeden zweiten Tag, alle zwei Wochen
    other: 'zweite[nrs]?|zwei',
    units: {
      day: 'tag(?:e|en)?',
      week: 'wochen?',
      month: 'monat(?:e|en)?',
      year: 'jahr(?:e|en)?',
    },
    weekdays: 'werktage?n?|wochentage?n?',
    days: [
      'so(?:nntag)?(?:e|s)?',
      'mo(?:ntag)?(?:e|s)?',
      'di(?:enstag)?(?:e|s)?',
      'mi(?:ttwoch)?(?:e|s)?',
      'do(?:nnerstag)?(?:e|s)?',
      'fr(?:eitag)?(?:e|s)?',
      'sa(?:mstag)?(?:e|s)?|sonnabende?s?',
    ],
    and: 'und|&',
    on: 'am',
  },
  priority: { hoch: 3, mittel: 2, niedrig: 1, keine: 0 },
  // fällig am Freitag, bis Freitag
  due: String.raw`f(?:ä|ae)llig(?:\s+(?:am|bis))?|bis(?:\s+(?:zum|spätestens))?`,
};

const SPANISH: QuickAddWords = {
  repeat: {
    // cada día, cada 3 días, todos los lunes, todas las semanas
    every: String.raw`cada|todos\s+los|todas\s+las`,
    // cada dos semanas
    other: 'dos',
    units: {
      day: 'd[ií]as?',
      week: 'semanas?',
      month: 'mes(?:es)?',
      year: 'a[ñn]os?',
    },
    weekdays: String.raw`d[ií]as?\s+(?:laborables|h[aá]biles)`,
    days: [
      'dom(?:ingo)?s?',
      'lun(?:es)?',
      'mar(?:tes)?',
      'mi[eé](?:rcoles)?',
      'jue(?:ves)?',
      'vie(?:rnes)?',
      's[aá]b(?:ado)?s?',
    ],
    and: 'y|&',
    on: 'el|los',
  },
  priority: {
    alta: 3,
    alto: 3,
    media: 2,
    medio: 2,
    baja: 1,
    bajo: 1,
    ninguna: 0,
    ninguno: 0,
  },
  // vence el viernes, antes del viernes
  due: String.raw`vence(?:\s+el)?|antes\s+del?`,
};

const FRENCH: QuickAddWords = {
  repeat: {
    // chaque jour, tous les 2 jours, toutes les semaines, tous les lundis
    every: String.raw`chaque|tous\s+les|toutes\s+les`,
    // toutes les deux semaines
    other: 'deux',
    units: {
      day: 'jours?',
      week: 'semaines?',
      month: 'mois',
      year: 'ans?|ann[ée]es?',
    },
    weekdays: String.raw`jours?\s+(?:ouvrables?|ouvr[ée]s|de\s+semaine)`,
    days: [
      'dim(?:anche)?s?',
      'lun(?:di)?s?',
      'mar(?:di)?s?',
      'mer(?:credi)?s?',
      'jeu(?:di)?s?',
      'ven(?:dredi)?s?',
      'sam(?:edi)?s?',
    ],
    and: 'et|&',
    on: 'les?',
  },
  priority: {
    haute: 3,
    haut: 3,
    moyenne: 2,
    moyen: 2,
    basse: 1,
    bas: 1,
    aucune: 0,
    aucun: 0,
  },
  // échéance vendredi, avant le vendredi
  due: String.raw`[ée]ch[ée]ance(?:\s+le)?|avant(?:\s+le)?`,
};

const WORDS: Readonly<Record<string, QuickAddWords>> = {
  en: ENGLISH,
  de: GERMAN,
  es: SPANISH,
  fr: FRENCH,
};

/** The languages quick add reads besides English. */
export const QUICK_ADD_LANGUAGES: readonly string[] = ['de', 'es', 'fr'];

/** The base language of a tag ("de-AT" is German), or English for one quick add doesn't read. */
export function quickAddLanguage(language: string | undefined): string {
  const base = (language ?? 'en').toLowerCase().split(/[-_]/)[0]!;
  return WORDS[base] ? base : 'en';
}

/**
 * The word sets to read a line with, most wanted first: the language's own, then English (once,
 * when the language is English).
 */
export function quickAddWords(language: string | undefined): readonly QuickAddWords[] {
  const base = quickAddLanguage(language);
  return base === 'en' ? [ENGLISH] : [WORDS[base]!, ENGLISH];
}
