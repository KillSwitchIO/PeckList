import { describe, expect, it } from 'vitest';
import { ClockDriftError, compareHlc, formatHlc, HlcClock, isHlc, parseHlc } from './hlc.ts';

const T = Date.UTC(2026, 9, 20, 16, 0, 0, 0);

function clockAt(times: number[], node = 'a') {
  let i = 0;
  return new HlcClock({ node, now: () => times[Math.min(i++, times.length - 1)]! });
}

describe('HLC format', () => {
  it('formats and parses round-trip', () => {
    const value = formatHlc({ wall: T, counter: 7, node: 'dev7' });
    expect(value).toBe('2026-10-20T16:00:00.000Z-0007-dev7');
    expect(parseHlc(value)).toEqual({ wall: T, counter: 7, node: 'dev7' });
    expect(isHlc(value)).toBe(true);
  });

  it('rejects malformed values', () => {
    expect(() => parseHlc('nope')).toThrow('invalid HLC');
    expect(isHlc('2026-10-20T16:00:00Z-0001-a')).toBe(false);
  });

  it('orders by wall time, then counter, then node; missing sorts first', () => {
    const a = formatHlc({ wall: T, counter: 1, node: 'a' });
    const b = formatHlc({ wall: T, counter: 2, node: 'a' });
    const c = formatHlc({ wall: T, counter: 2, node: 'b' });
    const d = formatHlc({ wall: T + 1, counter: 0, node: 'a' });
    expect([d, c, a, b].sort(compareHlc)).toEqual([a, b, c, d]);
    expect(compareHlc(undefined, a)).toBe(-1);
    expect(compareHlc(a, undefined)).toBe(1);
    expect(compareHlc(a, a)).toBe(0);
  });

  it('rejects invalid node ids', () => {
    expect(() => new HlcClock({ node: 'has-dash' })).toThrow('invalid node id');
  });
});

describe('HlcClock.tick', () => {
  it('uses physical time when it moves forward', () => {
    const clock = clockAt([T, T + 5]);
    expect(clock.tick()).toBe(formatHlc({ wall: T, counter: 0, node: 'a' }));
    expect(clock.tick()).toBe(formatHlc({ wall: T + 5, counter: 0, node: 'a' }));
  });

  it('increments the counter when physical time stalls or goes backwards', () => {
    const clock = clockAt([T, T, T - 1000]);
    const first = clock.tick();
    const second = clock.tick();
    const third = clock.tick();
    expect(compareHlc(first, second)).toBe(-1);
    expect(compareHlc(second, third)).toBe(-1);
    expect(parseHlc(third)).toEqual({ wall: T, counter: 2, node: 'a' });
  });

  it('advances logical wall time when the counter is exhausted', () => {
    const clock = clockAt([T]);
    let last = clock.tick();
    for (let i = 0; i < 10000; i += 1) {
      const next = clock.tick();
      expect(compareHlc(last, next)).toBe(-1);
      last = next;
    }
    expect(parseHlc(last)).toEqual({ wall: T + 1, counter: 0, node: 'a' });
  });
});

describe('HlcClock.receive', () => {
  it('orders later local events after a remote event from the future', () => {
    const clock = clockAt([T]);
    const remote = formatHlc({ wall: T + 60_000, counter: 4, node: 'b' });
    const merged = clock.receive(remote);
    expect(parseHlc(merged)).toEqual({ wall: T + 60_000, counter: 5, node: 'a' });
    expect(compareHlc(remote, clock.tick())).toBe(-1);
  });

  it('keeps the local clock when it is ahead', () => {
    const clock = clockAt([T + 10, T + 10, T + 10]);
    clock.tick();
    const merged = clock.receive(formatHlc({ wall: T, counter: 9, node: 'b' }));
    expect(parseHlc(merged)).toEqual({ wall: T + 10, counter: 1, node: 'a' });
  });

  it('takes the larger counter when local and remote wall times match', () => {
    const clock = clockAt([T, T]);
    clock.tick();
    const merged = clock.receive(formatHlc({ wall: T, counter: 6, node: 'b' }));
    expect(parseHlc(merged)).toEqual({ wall: T, counter: 7, node: 'a' });
  });

  it('resets the counter when physical time is ahead of both', () => {
    const clock = clockAt([T, T + 100]);
    clock.tick();
    const merged = clock.receive(formatHlc({ wall: T + 50, counter: 3, node: 'b' }));
    expect(parseHlc(merged)).toEqual({ wall: T + 100, counter: 0, node: 'a' });
  });

  it('rejects remote clocks too far in the future', () => {
    const clock = new HlcClock({ node: 'a', now: () => T, maxDriftMs: 1000 });
    expect(() => clock.receive(formatHlc({ wall: T + 5000, counter: 0, node: 'b' }))).toThrow(
      ClockDriftError,
    );
  });
});
