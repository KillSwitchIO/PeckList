import { ensureContrast, WCAG_UI } from '../../core/palette.ts';

/** Tag icon color: the tag's own color, darkened or lightened just enough to read (3:1) on `surface`. */
export function tagIconColor(color: string, surface: string): string {
  return ensureContrast(color, surface, WCAG_UI);
}
