import type { Id } from '../../core/types.ts';

/**
 * The lists Duplicate list made (PL-139) this session, each with the list it came from. Undo takes
 * the copy away while its page is open, so the page goes back to that list instead of saying the
 * list no longer exists (QA, 2026-11-21).
 */
const copiedFrom = new Map<Id, Id>();

/** `copy` was just made from `original`. */
export function madeListCopy(copy: Id, original: Id): void {
  copiedFrom.set(copy, original);
}

/** The list `copy` was made from this session, if it was one. */
export function listCopiedFrom(copy: Id): Id | undefined {
  return copiedFrom.get(copy);
}
