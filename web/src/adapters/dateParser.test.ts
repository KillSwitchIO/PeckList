import * as de from 'chrono-node/de';
import * as es from 'chrono-node/es';
import * as fr from 'chrono-node/fr';
import { describe, expect, it } from 'vitest';
import type { DateParser } from '../ports/dateParser.ts';
import { createChronoDateParser } from './chrono-date-parser.ts';
import { loadDateParser, loadLocaleDateParser } from './chrono-locales.ts';
import { describeDateParserContract } from './dateParser.contract.ts';

const german = createChronoDateParser({ language: 'de', casual: de.casual });
const spanish = createChronoDateParser({ language: 'es', casual: es.casual });
const french = createChronoDateParser({ language: 'fr', casual: fr.casual });

describeDateParserContract('chrono-node', createChronoDateParser());
// English is read whatever the language (PL-148), so each localized parser passes the same contract.
describeDateParserContract('chrono-node, German', german);
describeDateParserContract('chrono-node, Spanish', spanish);
describeDateParserContract('chrono-node, French', french);

// Wednesday, Oct 21 2026, 10:00 local time.
const REFERENCE = new Date(2026, 9, 21, 10, 0);

const read = (parser: DateParser, text: string) =>
  parser.find(text, REFERENCE).map(({ index, length, start, end }) => ({
    text: text.slice(index, index + length),
    start,
    end,
  }));

describe('chrono-node in the app language (PL-148)', () => {
  it('reads a day and a time in each language', () => {
    expect(read(german, 'Arzt morgen 15 Uhr')).toEqual([
      { text: 'morgen 15 Uhr', start: { date: '2026-10-22', time: '15:00' }, end: null },
    ]);
    expect(read(spanish, 'Médico mañana a las 15:00')).toEqual([
      { text: 'mañana a las 15:00', start: { date: '2026-10-22', time: '15:00' }, end: null },
    ]);
    expect(read(french, 'Médecin demain 15h')).toEqual([
      { text: 'demain 15h', start: { date: '2026-10-22', time: '15:00' }, end: null },
    ]);
  });

  it('keeps the longer of two overlapping readings, so English still reads whole', () => {
    // German chrono sees only "3pm" here; English's "tomorrow 3pm" is longer and wins.
    expect(read(german, 'Call tomorrow 3pm')).toEqual([
      { text: 'tomorrow 3pm', start: { date: '2026-10-22', time: '15:00' }, end: null },
    ]);
  });

  it('reads the day after tomorrow, which chrono reads as tomorrow', () => {
    expect(read(spanish, 'pasado mañana a las 10')[0]).toMatchObject({
      text: 'pasado mañana a las 10',
      start: { date: '2026-10-23', time: '10:00' },
    });
    expect(read(french, 'après-demain')[0]).toMatchObject({
      text: 'après-demain',
      start: { date: '2026-10-23', time: null },
    });
  });

  it('reads both ends of a range of weekdays', () => {
    const week = {
      start: { date: '2026-10-26', time: null },
      end: { date: '2026-10-30', time: null },
    };
    expect(read(german, 'Montag bis Freitag')).toEqual([{ text: 'Montag bis Freitag', ...week }]);
    expect(read(german, 'Montag - Freitag')).toEqual([{ text: 'Montag - Freitag', ...week }]);
    expect(read(spanish, 'de lunes a viernes')).toEqual([{ text: 'de lunes a viernes', ...week }]);
    expect(read(french, 'du lundi au vendredi')).toEqual([
      { text: 'du lundi au vendredi', ...week },
    ]);
    // A range of times on one day is left as it is.
    expect(read(german, '9-11 Uhr')[0]).toMatchObject({
      start: { time: '09:00' },
      end: { time: '11:00' },
    });
  });

  it('takes the words after a time: afternoon, evening and morning, and "heures"', () => {
    expect(read(spanish, 'mañana a las 3 de la tarde')).toEqual([
      {
        text: 'mañana a las 3 de la tarde',
        start: { date: '2026-10-22', time: '15:00' },
        end: null,
      },
    ]);
    expect(read(spanish, 'a las 9 de la mañana')).toHaveLength(1);
    expect(read(spanish, 'a las 9 de la mañana')[0]!.start.time).toBe('09:00');
    expect(read(spanish, 'hoy a las 8 de la noche')[0]!.start.time).toBe('20:00');
    expect(read(french, 'demain 3h de l’après-midi')[0]).toMatchObject({
      text: 'demain 3h de l’après-midi',
      start: { time: '15:00' },
    });
    expect(read(french, 'demain à 15 heures')[0]!.text).toBe('demain à 15 heures');
  });

  it('takes the word before a date, so it leaves the title', () => {
    expect(read(spanish, 'Llamar el viernes')[0]!.text).toBe('el viernes');
    expect(read(spanish, 'Pan a las 17:00')[0]!.text).toBe('a las 17:00');
    expect(read(french, 'Facture le 12 décembre')[0]!.text).toBe('le 12 décembre');
    expect(read(german, 'Urlaub von Montag bis Freitag')[0]!.text).toBe('von Montag bis Freitag');
  });

  it('reads a bare hour as written, as English does; its word makes it the afternoon', () => {
    const time = (parser: DateParser, text: string) => read(parser, text)[0]!.start.time;
    expect(time(createChronoDateParser(), 'tomorrow at 3')).toBe('03:00');
    expect(time(german, 'morgen 3 Uhr')).toBe('03:00');
    expect(time(german, 'morgen 3 Uhr nachmittags')).toBe('15:00');
    expect(time(spanish, 'mañana a las 3')).toBe('03:00');
    expect(time(french, 'demain 3h')).toBe('03:00');
    expect(time(french, 'demain 3h de l’après-midi')).toBe('15:00');
  });

  it('leaves a match that ends in a range word joining nothing', () => {
    // chrono-es reads "de 3 a" in "Clase de 3 a 5" as tomorrow 03:00 (Dev 1).
    expect(read(spanish, 'Clase de 3 a 5')).toEqual([]);
  });

  it('reads English alone when no language is given', () => {
    expect(read(createChronoDateParser(), 'Arzt morgen')).toEqual([]);
  });
});

describe('loadDateParser', () => {
  it('loads the language of a tag, and English alone for one quick add does not read', async () => {
    const austrian = await loadDateParser('de-AT');
    expect(austrian.find('morgen', REFERENCE)[0]!.start.date).toBe('2026-10-22');
    const portuguese = await loadDateParser('pt');
    expect(portuguese.find('amanhã', REFERENCE)).toEqual([]);
    expect(portuguese.find('tomorrow', REFERENCE)[0]!.start.date).toBe('2026-10-22');
  });
});
describe('loadLocaleDateParser', () => {
  it('says when the language’s own chrono did not load, and reads English then', async () => {
    const failed = await loadLocaleDateParser('de', () =>
      Promise.reject(new TypeError('Failed to fetch dynamically imported module')),
    );
    expect(failed.complete).toBe(false);
    const now = new Date(2026, 10, 21, 10, 0);
    expect(failed.parser.find('Arzt morgen', now)).toHaveLength(0);
    expect(failed.parser.find('Doctor tomorrow', now)).toHaveLength(1);
    expect((await loadLocaleDateParser('de')).complete).toBe(true);
    expect((await loadLocaleDateParser('en')).complete).toBe(true);
  });
});

describe('chrono-node, two readings of the same words', () => {
  it('takes the one that names a day, then the language’s own', () => {
    // Spanish chrono reads "oct 1" as October 2001; English as October 1st.
    expect(read(spanish, 'oct 1')[0]!.start.date).toBe('2027-10-01');
    // Both name a day: the language's own order wins, day first.
    expect(read(spanish, '12/11')[0]!.start.date).toBe('2026-11-12');
    expect(read(createChronoDateParser(), '12/11')[0]!.start.date).toBe('2026-12-11');
  });
});
