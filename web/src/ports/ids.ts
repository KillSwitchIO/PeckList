import type { Id } from '../core/types.ts';

/** Produces globally unique, time-sortable ids (ULIDs). */
export interface IdGenerator {
  next(): Id;
}
