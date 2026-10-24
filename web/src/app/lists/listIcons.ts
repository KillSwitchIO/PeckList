/** Emoji a to-do list is likely to want; any other can be typed. */
// prettier-ignore
export const LIST_ICONS = [
  '📥', '✅', '📌', '⭐', '🔥', '💡', '📝', '📅',
  '💼', '🏠', '🛒', '🍳', '💰', '🧾', '📚', '🎓',
  '🏋️', '🏃', '🧘', '❤️', '🩺', '💊', '🐶', '🌱',
  '🚗', '✈️', '🧳', '🏖️', '🎮', '🎵', '🎬', '🎁',
  '🎉', '🛠️', '💻', '📱', '🧹', '👪', '🙏', '🌙',
] as const;

/** The first character a person sees in `text` (an emoji may be several code points), or null. */
export function firstGrapheme(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (typeof Intl.Segmenter === 'function') {
    const [first] = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(trimmed);
    return first?.segment ?? null;
  }
  return Array.from(trimmed)[0] ?? null;
}
