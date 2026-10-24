// A user's preferences (spec: PL-025), in the workspace `settings` entity so they sync.

import { putEntity } from './collections.ts';
import { updateEntity, type OpContext } from './ops.ts';
import type { Settings, WorkspaceFile } from './types.ts';

/** Fields a user changes from the Settings page. */
export type SettingsPatch = Partial<
  Pick<
    Settings,
    | 'themeMode'
    | 'pointEventMinutes'
    | 'dueSoonDays'
    | 'clockFormat'
    | 'weekStart'
    | 'timeZone'
    | 'newTask'
  >
>;

/** Change some settings; values that are already set leave the workspace as it is. */
export function updateSettings(
  ctx: OpContext,
  workspace: WorkspaceFile,
  patch: SettingsPatch,
): WorkspaceFile {
  const settings = workspace.entities.settings[0];
  if (!settings) return workspace;
  const changed = Object.entries(patch).filter(
    ([key, value]) => settings[key as keyof Settings] !== value,
  );
  if (changed.length === 0) return workspace;
  return putEntity(
    workspace,
    'settings',
    updateEntity(ctx, settings, Object.fromEntries(changed) as SettingsPatch),
  );
}

/** Choices the Settings page offers. */
export const DUE_SOON_CHOICES = [0, 1, 2, 3, 5, 7] as const;
export const POINT_EVENT_CHOICES = [15, 30, 45, 60, 90, 120] as const;
