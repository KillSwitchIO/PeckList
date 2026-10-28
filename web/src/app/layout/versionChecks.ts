import { pageStatus } from '../../core/versions.ts';
import { t } from '../i18n/i18n.ts';
import { useShellInfo } from '../native/shell.ts';
import { useSyncState } from '../sync/syncContext.ts';

/**
 * The shell features this web build uses (api 3: reminders set from the app). An app with less
 * still runs it, but without them: it wants an update.
 */
export const SHELL_API_WANTED = 3;

/** This page against its server's version: null without a server (nothing to compare). */
export function usePageStatus(page: string): { ok: boolean; explanation: string } | null {
  const server = useSyncState((state) => state.server?.version ?? null);
  if (!server) return null;
  return pageStatus(page, server) === 'same'
    ? { ok: true, explanation: t('version.pageSame', { server }) }
    : { ok: false, explanation: t('version.pageDifferent', { page, server }) };
}

/** The Android app against the web build its server runs: null in a browser. */
export function useAppStatus(): { ok: boolean; explanation: string } | null {
  const { info } = useShellInfo();
  const server = useSyncState((state) => state.server?.version ?? null);
  if (!info) return null;
  if (!info.server || !server) return { ok: true, explanation: t('version.appStandalone') };
  return info.api >= SHELL_API_WANTED
    ? { ok: true, explanation: t('version.appWorks', { server }) }
    : { ok: false, explanation: t('version.appTooOld', { server }) };
}
