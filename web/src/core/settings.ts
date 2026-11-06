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
    | 'dateFormat'
    | 'weekStart'
    | 'timeZone'
    | 'newTask'
    | 'allDayReminderTime'
    | 'notifications'
    | 'purgeAfterDays'
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
/** Days deleted, completed and won't-do tasks stay: 7, 15 or 30 days, or 2 to 12 months (a month is 30 days, a year 365). */
export const PURGE_CHOICES = [
  7, 15, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 365,
] as const;
export const DEFAULT_PURGE_DAYS = 30;

/** How long this person keeps deleted, completed and won't-do tasks. */
export function purgeDaysOf(workspace: WorkspaceFile): number {
  return workspace.entities.settings[0]?.purgeAfterDays ?? DEFAULT_PURGE_DAYS;
}
