/** "wdjbmjht" as it is shown: upper case, the code's letters only, a dash after four. */
export function formatCode(typed: string): string {
  const letters = typed
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 8);
  return letters.length > 4 ? `${letters.slice(0, 4)}-${letters.slice(4)}` : letters;
}
