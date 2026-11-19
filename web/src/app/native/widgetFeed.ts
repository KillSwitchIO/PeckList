import { useEffect, useRef, useState } from 'react';
import { widgetFeed } from '../../core/widgetTasks.ts';
import { useToday } from '../hooks/useToday.ts';
import { useStoreState } from '../store/hooks.ts';
import { nativeShell } from './shell.ts';

/** The shell api with home-screen widgets (PL-121). */
export const WIDGETS_API = 12;

/**
 * Keeps the Android home-screen widgets on today's tasks (shell api 12), handed over when they
 * change. Signing out empties them, so they ask to open the app (PhoneSignedOut).
 */
export function WidgetFeed() {
  const workspace = useStoreState((state) => state.workspace);
  const today = useToday();
  const [api, setApi] = useState(0);
  const sent = useRef<string | null>(null);

  useEffect(() => {
    const shell = nativeShell();
    if (!shell) return;
    let live = true;
    shell.info().then(
      (info) => live && setApi(info.api),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const shell = nativeShell();
    if (!shell?.setWidgetTasks || api < WIDGETS_API || !workspace) return;
    const feed = widgetFeed(workspace, today);
    const text = JSON.stringify(feed);
    if (text === sent.current) return;
    sent.current = text;
    shell.setWidgetTasks(feed).catch(() => undefined);
  }, [workspace, today, api]);

  return null;
}
