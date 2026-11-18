import { Link } from '@mui/material';
import {
  Fragment,
  useCallback,
  useMemo,
  useState,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { findSmartLinks } from '../../core/smartLinks.ts';
import { createLongPress } from './longPress.ts';
import { mainHref, openOutside, touchClick } from './openOutside.ts';
import { SmartLinkMenu, type SmartTarget } from './SmartLinkMenu.tsx';

/**
 * Plain text with its smart links (PL-146) as buttons: a tap does the main thing (call, open the
 * page or the maps app), a click with the mouse or the keyboard offers the choices. For text that
 * is shown, not edited (comments); the notes editor finds them itself.
 */
export function SmartText({ text }: { text: string }) {
  const items = useMemo(() => findSmartLinks(text), [text]);
  const [open, setOpen] = useState<
    (SmartTarget & { anchor: { top: number; left: number } }) | null
  >(null);
  const close = useCallback(() => setOpen(null), []);
  const [longPress] = useState(createLongPress);
  if (items.length === 0) return text;
  const parts = [];
  let at = 0;
  for (const item of items) {
    if (item.from > at) parts.push(<Fragment key={at}>{text.slice(at, item.from)}</Fragment>);
    const target: SmartTarget = { kind: item.kind, text: item.text };
    parts.push(
      <Link
        key={item.from}
        component="button"
        type="button"
        data-smart={item.kind}
        // A long press offers the choices on any screen (a right-click keeps the browser menu).
        onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const anchor = { top: rect.bottom, left: rect.left };
          longPress.down(event.nativeEvent, () => setOpen({ ...target, anchor }));
        }}
        onPointerMove={(event: PointerEvent<HTMLButtonElement>) =>
          longPress.move(event.nativeEvent)
        }
        onPointerUp={() => longPress.cancel()}
        onPointerCancel={() => longPress.cancel()}
        onContextMenu={(event: MouseEvent<HTMLButtonElement>) => {
          // A right-click with the mouse keeps the browser's own menu.
          if (!touchClick(event.nativeEvent)) return;
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          setOpen({ ...target, anchor: { top: rect.bottom, left: rect.left } });
        }}
        onClick={(event: MouseEvent<HTMLButtonElement>) => {
          if (longPress.takeFired()) return;
          if (touchClick(event.nativeEvent)) {
            openOutside(mainHref(item.kind, item.text));
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          setOpen({ ...target, anchor: { top: rect.bottom, left: rect.left } });
        }}
        sx={{ font: 'inherit', verticalAlign: 'baseline', textAlign: 'start' }}
      >
        {item.text}
      </Link>,
    );
    at = item.to;
  }
  if (at < text.length) parts.push(<Fragment key={at}>{text.slice(at)}</Fragment>);
  return (
    <>
      {parts}
      <SmartLinkMenu target={open} anchor={open?.anchor ?? null} onClose={close} />
    </>
  );
}
