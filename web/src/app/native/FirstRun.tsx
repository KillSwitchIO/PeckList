import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { choseStandalone, useShellInfo } from './shell.ts';

/**
 * The Android app's first start: with no server chosen yet, and no choice to stay on this device,
 * open the connect page. Renders nothing; does nothing in a browser.
 */
export function NativeFirstRun() {
  const { info } = useShellInfo();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const due =
    info !== null && info.server === null && !choseStandalone() && pathname !== '/connect';
  useEffect(() => {
    if (due) void navigate('/connect', { replace: true });
    // Once per start: after that the person moves around freely.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info]);
  return null;
}
