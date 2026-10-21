import { Box } from '@mui/material';
import { useRef, useState } from 'react';
import { t } from '../i18n/i18n.ts';

/**
 * A grip on the panel's left edge: drag to resize, double-click to reset.
 * `current` is the panel's rendered width in pixels.
 */
export function ResizeHandle({
  current,
  onResize,
  onReset,
}: {
  current: () => number;
  onResize: (width: number) => void;
  onReset: () => void;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [active, setActive] = useState(false);

  return (
    <Box
      role="separator"
      aria-orientation="vertical"
      aria-label={t('task.resizeDetails')}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        drag.current = { x: event.clientX, width: current() };
        setActive(true);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        // The panel sits on the right: moving left makes it wider.
        onResize(drag.current.width + drag.current.x - event.clientX);
      }}
      onPointerUp={() => {
        drag.current = null;
        setActive(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setActive(false);
      }}
      onDoubleClick={onReset}
      sx={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: -4,
        width: 8,
        zIndex: 1,
        cursor: 'col-resize',
        touchAction: 'none',
        // A thin line shows on hover and while dragging.
        '&::after': {
          content: '""',
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 3,
          width: 2,
          bgcolor: 'primary.main',
          opacity: active ? 1 : 0,
          transition: 'opacity 120ms',
        },
        '&:hover::after': { opacity: 1 },
      }}
    />
  );
}
