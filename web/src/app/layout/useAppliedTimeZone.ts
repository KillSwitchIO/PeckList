import { localTimeZone, setTimeZone } from '../../core/dates.ts';
import { useStoreState } from '../store/hooks.ts';
import { useSyncState } from '../sync/syncContext.ts';

const SERVER_ZONE_KEY = 'pecklist.serverTimeZone';

function remembered(): string | null {
  try {
    return localStorage.getItem(SERVER_ZONE_KEY);
  } catch {
    return null;
  }
}

function remember(zone: string | null) {
  try {
    if (zone === null) localStorage.removeItem(SERVER_ZONE_KEY);
    else if (localStorage.getItem(SERVER_ZONE_KEY) !== zone)
      localStorage.setItem(SERVER_ZONE_KEY, zone);
  } catch {
    // Private windows: the device's zone stands in while offline.
  }
}

/**
 * The time zone "today" and times are in (spec: PL-086): the person's own choice, else the one the
 * server's operator set (remembered for offline starts), else the device's. A server that answers
 * with no zone clears the remembered one; no answer yet says nothing, so an offline start keeps it.
 * Applied as it renders, so the pages below see it at once; returns it so they can start over when
 * it changes.
 */
export function useAppliedTimeZone(): string {
  const chosen = useStoreState((state) => state.workspace?.entities.settings[0]?.timeZone ?? null);
  const answered = useSyncState((state) => state.server !== null);
  const server = useSyncState((state) => state.server?.timeZone ?? null);
  if (answered) remember(server);
  setTimeZone(chosen ?? server ?? remembered());
  return localTimeZone();
}
