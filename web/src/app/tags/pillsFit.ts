export const GAP = 6;
export const PLUS = 22;
const MORE = 30;

/**
 * How many pills of these widths fit in `room`, leaving space for the round + and, when some
 * don't fit, for "+N".
 */
export function pillsThatFit(widths: number[], room: number): number {
  const total = (count: number) =>
    widths.slice(0, count).reduce((sum, width) => sum + width + GAP, 0) +
    PLUS +
    (count < widths.length ? MORE + GAP : 0);
  let count = widths.length;
  while (count > 0 && total(count) > room) count--;
  return count;
}
