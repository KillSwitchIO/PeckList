/** The first letters of the first and last names (Ben Dimit: BD), or of a one-word name. */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/[\s._-]+/u)
    .filter((word) => word.length > 0);
  const first = (word: string | undefined) => (word ? (Array.from(word)[0] ?? '') : '');
  if (words.length === 0) return '?';
  if (words.length === 1) return first(words[0]).toUpperCase();
  return (first(words[0]) + first(words[words.length - 1])).toUpperCase();
}
