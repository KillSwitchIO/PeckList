import { describe, expect, it } from 'vitest';
import { formatTime } from '../format.ts';
import { minutesEarlyText, reminderLabel, reminderParts } from './reminderText.ts';

describe('reminder text', () => {
  it('says whole minutes, hours and days early as before', () => {
    expect(minutesEarlyText(0)).toBe('On time');
    expect(minutesEarlyText(1)).toBe('1 minute early');
    expect(minutesEarlyText(30)).toBe('30 minutes early');
    expect(minutesEarlyText(60)).toBe('1 hour early');
    expect(minutesEarlyText(120)).toBe('2 hours early');
    expect(minutesEarlyText(1440)).toBe('1 day early');
  });

  it('says hours and minutes, and after for a reminder later than the task, never a negative early', () => {
    expect(minutesEarlyText(538)).toBe('8 hours 58 minutes early');
    expect(minutesEarlyText(61)).toBe('1 hour 1 minute early');
    expect(minutesEarlyText(-538)).toBe('8 hours 58 minutes after');
    expect(minutesEarlyText(-60)).toBe('1 hour after');
    expect(minutesEarlyText(-1)).toBe('1 minute after');
    expect(minutesEarlyText(-1500)).toBe('1 day 1 hour after');
  });

  it('shows a reminder set at a time of day on a timed task as its day and clock time (Ben, rc.3)', () => {
    // Custom, Day tab, on the day at 14:58 on a task at 6:00: 538 minutes after its start.
    expect(reminderParts({ before: -538 }, false, '2026-11-19', '06:00')).toEqual({
      text: 'On the day',
      time: formatTime('14:58'),
    });
    expect(reminderLabel({ before: -538 }, false, '2026-11-19', '06:00')).toBe(
      `On the day (${formatTime('14:58')})`,
    );
    // Earlier the same day, at a time that is no whole number of hours early.
    expect(reminderParts({ before: 270 }, false, '2026-11-19', '14:00')).toEqual({
      text: 'On the day',
      time: formatTime('09:30'),
    });
    // Past midnight after a late task: the next day.
    expect(reminderParts({ before: -180 }, false, '2026-11-19', '22:30')).toEqual({
      text: '1 day after',
      time: formatTime('01:30'),
    });
    // Days early at a time, as before (R-FB-91).
    expect(reminderParts({ before: 1440 + 120 }, false, '2026-11-19', '16:00')).toEqual({
      text: '1 day early',
      time: formatTime('14:00'),
    });
    // More than an hour and not whole hours (only Custom's Day tab makes these): its time.
    expect(reminderParts({ before: 90 }, false, '2026-11-19', '16:00')).toEqual({
      text: 'On the day',
      time: formatTime('14:30'),
    });
    // Whole minutes or hours early stay words.
    expect(reminderParts({ before: 45 }, false, '2026-11-19', '16:00')).toEqual({
      text: '45 minutes early',
    });
    expect(reminderParts({ before: 120 }, false, '2026-11-19', '16:00')).toEqual({
      text: '2 hours early',
    });
  });

  it('says half a day or more early on an earlier day as that day and its time (QA, 0.14.0)', () => {
    // Custom Day "1 day early" at 2:00 PM on a 6:00 AM task is 16 whole hours early.
    expect(reminderLabel({ before: 960 }, false, '2026-11-19', '06:00')).toBe(
      `1 day early (${formatTime('14:00')})`,
    );
    expect(reminderParts({ before: 720 }, false, '2026-11-19', '06:00')).toEqual({
      text: '1 day early',
      time: formatTime('18:00'),
    });
    // The same hours on the task's own day stay hours.
    expect(reminderParts({ before: 960 }, false, '2026-11-19', '18:00')).toEqual({
      text: '16 hours early',
    });
    // Short offsets past midnight stay words, and whole days stay "1 day early".
    expect(reminderParts({ before: 120 }, false, '2026-11-19', '01:00')).toEqual({
      text: '2 hours early',
    });
    expect(reminderParts({ before: 1440 }, false, '2026-11-19', '06:00')).toEqual({
      text: '1 day early',
    });
  });

  it('with no start to count from, says after in hours and minutes', () => {
    expect(reminderLabel({ before: -538 }, false, '')).toBe('8 hours 58 minutes after');
  });

  it('keeps an all-day reminder on its day, including one past midnight', () => {
    expect(reminderParts({ before: 0 }, true, '2026-11-19')).toEqual({
      text: 'On the day',
      time: formatTime('09:00'),
    });
    expect(reminderParts({ before: 1440 }, true, '2026-11-19')).toEqual({
      text: '1 day early',
      time: formatTime('09:00'),
    });
    // From another device or the API: later than the day's end.
    expect(reminderParts({ before: -960 }, true, '2026-11-19')).toEqual({
      text: '1 day after',
      time: formatTime('01:00'),
    });
  });
});
