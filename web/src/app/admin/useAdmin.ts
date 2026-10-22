import { useCallback, useEffect, useState } from 'react';
import type { AdminApi, AdminRefusal } from '../../ports/admin.ts';
import { t } from '../i18n/i18n.ts';
import { useSyncState } from '../sync/syncContext.ts';

/** The admin API when the signed-in account is an admin or super admin on a server, else null. */
export function useAdminApi(): AdminApi | null {
  const transport = useSyncState((state) => state.transport);
  const isAdmin = useSyncState(
    (state) =>
      state.phase === 'ready' &&
      (state.account?.role === 'admin' || state.account?.role === 'superadmin'),
  );
  return isAdmin && transport.admin ? transport.admin : null;
}

export function useIsSuperAdmin(): boolean {
  return useSyncState((state) => state.account?.role === 'superadmin');
}

/** Something loaded from the server, and a way to load it again after a change. */
export function useLoaded<T>(load: () => Promise<T>): { data: T | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    load().then(
      (value) => live && setData(value),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [load, version]);
  const reload = useCallback(() => setVersion((each) => each + 1), []);
  return { data, reload };
}

/** What to tell the admin when the server refuses. */
export function refusalText(reason: AdminRefusal): string {
  return t(`admin.refused.${reason}`);
}
