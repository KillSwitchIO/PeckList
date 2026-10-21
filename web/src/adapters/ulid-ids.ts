import { monotonicFactory } from 'ulid';
import type { IdGenerator } from '../ports/ids.ts';

export function createUlidGenerator(): IdGenerator {
  const next = monotonicFactory();
  return { next: () => next() };
}
