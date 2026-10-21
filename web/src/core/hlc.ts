// Hybrid logical clock.
//
// Format: `<ISO wall time>-<4-digit counter>-<node id>`, e.g.
// `2026-10-20T16:15:02.113Z-0001-dev7`. The format is fixed-width up to the node id,
// so plain string comparison orders timestamps correctly, and the node id breaks ties.

import type { Hlc } from './types.ts';

const MAX_COUNTER = 9999;
const NODE_PATTERN = /^[A-Za-z0-9]{1,32}$/;
const HLC_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)-(\d{4})-([A-Za-z0-9]{1,32})$/;

export interface ParsedHlc {
  wall: number;
  counter: number;
  node: string;
}

export class ClockDriftError extends Error {
  constructor(
    readonly remoteWall: number,
    readonly localWall: number,
  ) {
    super(`remote clock is ${remoteWall - localWall} ms ahead of the local clock`);
    this.name = 'ClockDriftError';
  }
}

export function formatHlc({ wall, counter, node }: ParsedHlc): Hlc {
  return `${new Date(wall).toISOString()}-${String(counter).padStart(4, '0')}-${node}`;
}

export function parseHlc(value: Hlc): ParsedHlc {
  const match = HLC_PATTERN.exec(value);
  if (!match) {
    throw new Error(`invalid HLC: ${value}`);
  }
  const [, iso, counter, node] = match as unknown as [string, string, string, string];
  return { wall: Date.parse(iso), counter: Number(counter), node };
}

export function isHlc(value: string): boolean {
  return HLC_PATTERN.test(value);
}

/** Compare two HLCs. Missing values sort before everything. */
export function compareHlc(a: Hlc | undefined, b: Hlc | undefined): number {
  const left = a ?? '';
  const right = b ?? '';
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export interface HlcClockOptions {
  node: string;
  now?: () => number;
  /** Reject remote timestamps further than this ahead of the local clock. */
  maxDriftMs?: number;
}

export class HlcClock {
  readonly node: string;
  private readonly now: () => number;
  private readonly maxDriftMs: number;
  private wall = 0;
  private counter = 0;

  constructor({ node, now = Date.now, maxDriftMs = 24 * 60 * 60 * 1000 }: HlcClockOptions) {
    if (!NODE_PATTERN.test(node)) {
      throw new Error(`invalid node id: ${node}`);
    }
    this.node = node;
    this.now = now;
    this.maxDriftMs = maxDriftMs;
  }

  /** Timestamp for a local event. Always greater than every timestamp seen before. */
  tick(): Hlc {
    const physical = this.now();
    if (physical > this.wall) {
      this.wall = physical;
      this.counter = 0;
    } else {
      this.bump(this.counter + 1);
    }
    return this.current();
  }

  /** Merge a timestamp received from another node so later local events order after it. */
  receive(remote: Hlc): Hlc {
    const r = parseHlc(remote);
    const physical = this.now();
    if (r.wall - physical > this.maxDriftMs) {
      throw new ClockDriftError(r.wall, physical);
    }
    const wall = Math.max(this.wall, r.wall, physical);
    if (wall === this.wall && wall === r.wall) {
      this.bump(Math.max(this.counter, r.counter) + 1);
    } else if (wall === this.wall) {
      this.bump(this.counter + 1);
    } else if (wall === r.wall) {
      this.wall = wall;
      this.bump(r.counter + 1);
    } else {
      this.wall = wall;
      this.counter = 0;
    }
    return this.current();
  }

  private bump(counter: number): void {
    if (counter > MAX_COUNTER) {
      // Counter exhausted within one millisecond: advance logical wall time instead.
      this.wall += 1;
      this.counter = 0;
    } else {
      this.counter = counter;
    }
  }

  private current(): Hlc {
    return formatHlc({ wall: this.wall, counter: this.counter, node: this.node });
  }
}
