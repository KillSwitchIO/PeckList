import { describe, expect, it } from 'vitest';
import { contrastRatio, DARK_SURFACE, LIGHT_SURFACE } from './palette.ts';
import {
  EVENT_COLOR,
  eventInk,
  eventItems,
  eventsBetween,
  monthDays,
  monthsCovering,
  placeEvent,
  placeEvents,
  type ShownEvent,
} from './calendarEvents.ts';

function event(over: Partial<ShownEvent> = {}): ShownEvent {
  return {
    id: 'ev1',
    linkId: 'link1',
    occurrence: '2026-12-01',
    title: 'Dentist',
    notes: '',
    start: '2026-12-01T10:00',
    end: '2026-12-01T10:45',
    allDay: false,
    timeZone: 'Europe/Berlin',
    recurring: false,
    editable: true,
    color: '#3366cc',
    ...over,
  };
}

describe('placing shown events (PL-134)', () => {
  it('shows a timed event on the viewer clock', () => {
    const placed = placeEvent(event(), 'America/Chicago');
    expect(placed).toMatchObject({
      start: '2026-12-01T03:00',
      end: '2026-12-01T03:45',
      allDay: false,
      first: '2026-12-01',
      last: '2026-12-01',
    });
  });

  it('moves an event late in its own zone to the next day of the viewer', () => {
    const placed = placeEvent(
      event({ start: '2026-12-01T23:30', end: '2026-12-02T00:15', timeZone: 'UTC' }),
      'Europe/Berlin',
    );
    expect(placed.first).toBe('2026-12-02');
    expect(placed.start).toBe('2026-12-02T00:30');
  });

  it('reads a floating time as the viewer own', () => {
    expect(placeEvent(event({ timeZone: null }), 'Asia/Tokyo').start).toBe('2026-12-01T10:00');
  });

  it('gives a timed event with no end thirty minutes', () => {
    expect(placeEvent(event({ end: null }), 'Europe/Berlin').end).toBe('2026-12-01T10:30');
  });

  it('ends an event that stops at midnight on the day before', () => {
    const placed = placeEvent(
      event({ start: '2026-12-01T22:00', end: '2026-12-02T00:00' }),
      'Europe/Berlin',
    );
    expect(placed.last).toBe('2026-12-01');
  });

  it('turns an all-day end, the day after, into the last day', () => {
    const one = placeEvent(event({ allDay: true, start: '2026-12-01', end: '2026-12-02' }), 'UTC');
    const three = placeEvent(
      event({ allDay: true, start: '2026-12-01', end: '2026-12-04' }),
      'UTC',
    );
    expect(one).toMatchObject({
      start: '2026-12-01',
      end: null,
      first: '2026-12-01',
      last: '2026-12-01',
    });
    expect(three).toMatchObject({ end: '2026-12-03', last: '2026-12-03' });
  });

  it('keeps all-day events on their dates whatever the viewer zone', () => {
    const placed = placeEvent(
      event({
        allDay: true,
        start: '2026-12-01',
        end: '2026-12-02',
        timeZone: 'Pacific/Kiritimati',
      }),
      'Pacific/Pago_Pago',
    );
    expect(placed.first).toBe('2026-12-01');
  });

  it('lists all-day events first, then by time, each occurrence once, leaving out held ones', () => {
    const events = [
      event({ id: 'late', start: '2026-12-01T15:00', end: null }),
      event({ id: 'early', start: '2026-12-01T08:00', end: null }),
      event({ id: 'day', allDay: true, start: '2026-12-01', end: '2026-12-02' }),
      event({ id: 'early', start: '2026-12-01T08:00', end: null }),
      event({ id: 'gone', start: '2026-12-01T09:00', end: null }),
    ];
    const placed = placeEvents(events, 'UTC', new Set(['gone|2026-12-01']));
    expect(placed.map((each) => each.event.id)).toEqual(['day', 'early', 'late']);
  });

  it('finds the events touching a range, a span across it included', () => {
    const placed = placeEvents(
      [
        event({ id: 'span', allDay: true, start: '2026-11-29', end: '2026-12-03' }),
        event({ id: 'after', start: '2026-12-05T09:00', end: null, timeZone: 'UTC' }),
      ],
      'UTC',
    );
    expect(eventsBetween(placed, '2026-12-01', '2026-12-02').map((each) => each.event.id)).toEqual([
      'span',
    ]);
  });

  it('makes calendar items that never move and carry the calendar colour', () => {
    const [item] = eventItems(
      placeEvents(
        [event({ color: null }), event({ id: 'ev2', color: '#00aa00' })],
        'Europe/Berlin',
      ),
      '2026-12-01',
      '2026-12-01',
    );
    expect(item).toMatchObject({
      kind: 'event',
      movable: false,
      eventKey: 'ev1|2026-12-01',
      taskId: '',
    });
    expect(item?.color).toMatch(/^#/);
  });
});

describe('fetching events by month', () => {
  it('covers the months of a range with a day to spare either side', () => {
    expect(monthsCovering('2026-12-01', '2026-12-31')).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(monthsCovering('2026-12-10', '2026-12-20')).toEqual(['2026-12']);
  });

  it('knows each month first and last day', () => {
    expect(monthDays('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthDays('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});

describe('eventInk', () => {
  it('keeps a calendar colour that already stands out', () => {
    expect(eventInk('#2E86DE', LIGHT_SURFACE)).toBe('#2E86DE');
  });

  it('lightens a dark colour in dark and darkens a pale one in light, to 3:1', () => {
    const dark = eventInk('#1E272E', DARK_SURFACE);
    expect(contrastRatio(dark, DARK_SURFACE)).toBeGreaterThanOrEqual(3);
    const pale = eventInk('#F1C40F', LIGHT_SURFACE);
    expect(contrastRatio(pale, LIGHT_SURFACE)).toBeGreaterThanOrEqual(3);
  });

  it('uses the default colour for none, or one it cannot read', () => {
    expect(eventInk(null, LIGHT_SURFACE)).toBe(EVENT_COLOR);
    expect(eventInk('red', LIGHT_SURFACE)).toBe(EVENT_COLOR);
  });
});
