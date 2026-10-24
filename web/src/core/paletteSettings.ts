// The palette editor's model (spec: PL-018): a named preset to start from
// (`settings.palettePreset`) and the user's changes on top (`settings.palette`, slot -> hex), both
// synced. Only changed slots are kept, so a reset goes back to the preset, and new preset colors
// reach anyone who never changed a slot.

import { putEntity } from './collections.ts';
import { updateEntity, type OpContext } from './ops.ts';
import {
  contrastRatio,
  DEFAULT_PRESET,
  LIGHT_SURFACE,
  PALETTE_DEFAULTS,
  PALETTE_PRESETS,
  type PalettePreset,
  type PaletteSlot,
} from './palette.ts';
import type { WorkspaceFile } from './types.ts';

/** Slots in the order the editor shows them, with what each color is used for. */
export const PALETTE_SLOTS: { slot: PaletteSlot; use: 'text' | 'ring' | 'fill' }[] = [
  { slot: 'accent', use: 'text' },
  { slot: 'accentContainer', use: 'fill' },
  { slot: 'priorityHigh', use: 'ring' },
  { slot: 'priorityMedium', use: 'ring' },
  { slot: 'priorityLow', use: 'ring' },
  { slot: 'priorityNone', use: 'ring' },
  { slot: 'late', use: 'text' },
  { slot: 'slipped', use: 'text' },
];

const HEX = /^#[0-9a-f]{6}$/i;

/** The user's overrides (only valid ones). */
export function paletteOverrides(workspace: WorkspaceFile): Partial<Record<PaletteSlot, string>> {
  const saved = workspace.entities.settings[0]?.palette ?? {};
  return Object.fromEntries(
    Object.entries(saved).filter(([slot, color]) => slot in PALETTE_DEFAULTS && HEX.test(color)),
  ) as Partial<Record<PaletteSlot, string>>;
}

/** The preset the colors start from (an unknown one, say from a newer app: Punchlist's). */
export function palettePreset(workspace: WorkspaceFile): PalettePreset {
  const saved = workspace.entities.settings[0]?.palettePreset;
  return saved && saved in PALETTE_PRESETS ? (saved as PalettePreset) : DEFAULT_PRESET;
}

/** The preset's color for a slot: what "Use the preset's color" brings back. */
export function presetColor(workspace: WorkspaceFile, slot: PaletteSlot): string {
  return PALETTE_PRESETS[palettePreset(workspace)][slot];
}

/** A slot's color: the user's, else the preset's. */
export function paletteColor(workspace: WorkspaceFile, slot: PaletteSlot): string {
  return paletteOverrides(workspace)[slot] ?? presetColor(workspace, slot);
}

/** What the theme draws with: the preset's colors where they differ from the defaults, and the user's. */
export function effectivePalette(workspace: WorkspaceFile): Partial<Record<PaletteSlot, string>> {
  const preset = PALETTE_PRESETS[palettePreset(workspace)];
  const fromPreset = Object.fromEntries(
    Object.entries(preset).filter(
      ([slot, color]) => PALETTE_DEFAULTS[slot as PaletteSlot] !== color,
    ),
  );
  return { ...fromPreset, ...paletteOverrides(workspace) };
}

/** Start from another preset; changes made on the old one go. */
export function setPalettePreset(
  ctx: OpContext,
  workspace: WorkspaceFile,
  preset: PalettePreset,
): WorkspaceFile {
  const settings = workspace.entities.settings[0];
  if (!settings) return workspace;
  const same =
    palettePreset(workspace) === preset && Object.keys(paletteOverrides(workspace)).length === 0;
  if (same) return workspace;
  return putEntity(
    workspace,
    'settings',
    updateEntity(ctx, settings, { palettePreset: preset, palette: {} }),
  );
}

function savePalette(
  ctx: OpContext,
  workspace: WorkspaceFile,
  palette: Record<string, string>,
): WorkspaceFile {
  const settings = workspace.entities.settings[0];
  if (!settings) return workspace;
  return putEntity(workspace, 'settings', updateEntity(ctx, settings, { palette }));
}

/** Change one slot; the preset's color (or null) takes the change away. */
export function setPaletteColor(
  ctx: OpContext,
  workspace: WorkspaceFile,
  slot: PaletteSlot,
  color: string | null,
): WorkspaceFile {
  const others = Object.fromEntries(
    Object.entries(paletteOverrides(workspace)).filter(([key]) => key !== slot),
  ) as Record<string, string>;
  if (color === null || color.toUpperCase() === presetColor(workspace, slot).toUpperCase()) {
    return savePalette(ctx, workspace, others);
  }
  if (!HEX.test(color)) return workspace;
  return savePalette(ctx, workspace, { ...others, [slot]: color.toUpperCase() });
}

/** Back to the preset's colors. */
export function resetPalette(ctx: OpContext, workspace: WorkspaceFile): WorkspaceFile {
  if (Object.keys(paletteOverrides(workspace)).length === 0) return workspace;
  return savePalette(ctx, workspace, {});
}

/** Below this against white a color is too pale to show as itself (the defaults are above 1.8). */
const FAINT = 1.6;

/**
 * Whether a color is too faint to show as picked. Punchlist always keeps text at 4.5:1 and
 * rings at 3:1 (WCAG AA) by darkening pale colors on the light background, which the default
 * pastels rely on; a pick paler than FAINT needs so much darkening that it no longer looks like
 * itself, and the editor says so.
 */
export function tooFaint(slot: PaletteSlot, color: string): boolean {
  const use = PALETTE_SLOTS.find((each) => each.slot === slot)?.use ?? 'fill';
  if (use === 'fill' || !HEX.test(color)) return false;
  return contrastRatio(color, LIGHT_SURFACE) < FAINT;
}
