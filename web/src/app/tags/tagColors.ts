import { buildPalette, ensureContrast, PASTEL_NAMES, WCAG_UI } from '../../core/palette.ts';
import { visibleTags } from '../../core/tags.ts';
import type { WorkspaceFile } from '../../core/types.ts';

const LIGHT = buildPalette('light');

/** Color for a new tag: walk the pastel slots so neighbouring tags differ. */
export function nextTagColor(workspace: WorkspaceFile): string {
  const name = PASTEL_NAMES[visibleTags(workspace).length % PASTEL_NAMES.length]!;
  return LIGHT.pastels[name].fill;
}

/** Tag icon color: the tag's own color, darkened or lightened just enough to read (3:1) on `surface`. */
export function tagIconColor(color: string, surface: string): string {
  return ensureContrast(color, surface, WCAG_UI);
}
