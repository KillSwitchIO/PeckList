// The English plurals (PL-148): one ICU message per count-dependent string, where the code once
// picked between a "One" and a "Many" key.
import { IntlMessageFormat } from 'intl-messageformat';
import { describe, expect, it } from 'vitest';
import { tooManyText } from '../friends/tooMany.ts';
import { minutesEarlyText, daysEarlyText } from '../reminders/reminderText.ts';
import { repeatLabel } from '../repeat/repeatText.ts';
import { noticeText } from '../sync/syncNotice.ts';
import en from './locales/en.json';
import { t, type MessageKey } from './i18n.ts';

describe('English plurals', () => {
  it('says "1 more list" and "1 more file", not "1 more lists"', () => {
    expect(noticeText({ refused: 0, lostLists: ['Home', 'Work'] })).toBe(
      'You no longer have access to "Home" and 1 more list.',
    );
    expect(noticeText({ refused: 0, lostLists: ['Home', 'Work', 'Trip'] })).toBe(
      'You no longer have access to "Home" and 2 more lists.',
    );
    expect(noticeText({ refused: 0, lostLists: ['Home'] })).toBe(
      'You no longer have access to "Home".',
    );
    expect(noticeText({ refused: 0, lostLists: [], filesKept: ['a.png', 'b.png'] })).toBe(
      '"a.png" and 1 more file are too large for the server, so they stay on this device only.',
    );
    expect(noticeText({ refused: 0, lostLists: [], filesWaiting: ['a.png', 'b.png'] })).toMatch(
      /^"a\.png" and 1 more file wait to upload/,
    );
  });

  it('says "1 task", "1 tag", "1 person" where it used to say "1 tasks"', () => {
    expect(t('bulk.moveTitle', { count: 1 })).toBe('Move 1 task to');
    expect(t('bulk.moveTitle', { count: 3 })).toBe('Move 3 tasks to');
    expect(t('bulk.changed', { count: 1 })).toBe('1 task changed');
    expect(t('task.moreTags', { count: 1 })).toBe('1 more tag');
    expect(t('profile.menuUnread', { menu: 'Sam', count: 1 })).toBe('Sam, 1 new notification');
    expect(t('telemetry.crashSeen', { count: 1, when: 'today' })).toBe('1 time, last today');
    expect(t('admin.handOver.list', { count: 1 })).toBe('Shared list, 1 person');
    expect(t('interchange.import.skipped', { count: 1 })).toBe(
      '1 task already here from an earlier import was left out.',
    );
    expect(t('settings.dueSoon.days', { days: 1 })).toBe('1 day before');
    expect(t('settings.hours', { hours: 1 })).toBe('1 hour');
  });

  it('keeps the words the singular had when they differ from the number', () => {
    expect(t('task.moreComments', { count: 0 })).toBe('Comments and history');
    expect(t('task.moreComments', { count: 1 })).toBe('1 comment, and history');
    expect(t('task.moreComments', { count: 12 })).toBe('12 comments, and history');
    expect(repeatLabel('FREQ=DAILY', '2026-11-20')).toBe('Daily');
    expect(repeatLabel('FREQ=WEEKLY;INTERVAL=2', '2026-11-20')).toBe('Every 2 weeks');
    expect(repeatLabel('FREQ=MONTHLY;COUNT=1', '2026-11-20')).toBe('Monthly, last time');
    expect(repeatLabel('FREQ=YEARLY;COUNT=3', '2026-11-20')).toBe('Yearly, 3 more times');
    expect(t('startOver.handed', { count: 1 })).toBe(
      'One shared list went to the next person in it.',
    );
    expect(tooManyText(0)).toBe('Too many lookups. Try again in a minute.');
    expect(tooManyText(5)).toBe('Too many lookups. Try again in 5 minutes.');
  });

  it('words reminder offsets in one message each', () => {
    expect(minutesEarlyText(1)).toBe('1 minute early');
    expect(minutesEarlyText(45)).toBe('45 minutes early');
    expect(minutesEarlyText(60)).toBe('1 hour early');
    expect(minutesEarlyText(1440)).toBe('1 day early');
    expect(minutesEarlyText(61)).toBe('1 hour 1 minute early');
    expect(minutesEarlyText(-1500)).toBe('1 day 1 hour after');
    expect(daysEarlyText(7)).toBe('1 week early');
    expect(daysEarlyText(14)).toBe('2 weeks early');
  });

  it('renders every English plural for 0, 1, 2 and 5 with nothing left unfilled', () => {
    const plurals = Object.entries(en).filter(([, message]) => message.includes(', plural,'));
    expect(plurals.length).toBeGreaterThan(30);
    for (const [key, message] of plurals) {
      const names = new Set<string>();
      const walk = (elements: ReturnType<IntlMessageFormat['getAst']>) => {
        for (const element of elements) {
          if ('value' in element && element.type !== 0 && typeof element.value === 'string') {
            names.add(element.value);
          }
          if ('options' in element) {
            for (const option of Object.values(element.options)) walk(option.value);
          }
        }
      };
      walk(new IntlMessageFormat(message, 'en').getAst());
      for (const count of [0, 1, 2, 5]) {
        const params = Object.fromEntries([...names].map((name) => [name, count]));
        const text = t(key as MessageKey, params);
        expect(text, `${key} with ${count}`).not.toMatch(/[{}#]/);
      }
    }
  });
});
