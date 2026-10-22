// Dragging a section by its header to reorder the list's sections (spec: PL-014). Mouse only: on
// touch the section menu's Move up and Move down do the same without fighting the scroll.

import { Box } from '@mui/material';
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';

const START_PX = 6;

interface Line {
  top: number;
  left: number;
  width: number;
}

/** Headers carry `data-section-head` (the section id); the drop line sits between them. */
export function useSectionDrag(onMove: (id: string, beforeId: string | null) => void) {
  const [line, setLine] = useState<Line | null>(null);
  const swallow = useRef(false);

  const start = (id: string) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.pointerType !== 'mouse') return;
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;
    let target: string | null | undefined;
    const move = (moved: PointerEvent) => {
      if (!dragging && Math.hypot(moved.clientX - startX, moved.clientY - startY) < START_PX)
        return;
      dragging = true;
      moved.preventDefault();
      const others = [...document.querySelectorAll<HTMLElement>('[data-section-head]')].filter(
        (head) => head.dataset.sectionHead !== id,
      );
      const next = others.find((head) => {
        const box = head.getBoundingClientRect();
        return moved.clientY < box.top + box.height / 2;
      });
      target = next ? next.dataset.sectionHead! : null;
      const reference = next ?? others[others.length - 1];
      if (!reference) {
        setLine(null);
        return;
      }
      const box = reference.getBoundingClientRect();
      const top = next
        ? box.top - 4
        : (reference.closest('section')?.getBoundingClientRect().bottom ?? box.bottom) + 4;
      setLine({ top, left: box.left, width: box.width });
    };
    const finish = (commit: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key, true);
      setLine(null);
      if (dragging) swallow.current = true;
      if (commit && dragging && target !== undefined) onMove(id, target);
    };
    const up = () => finish(true);
    const key = (pressed: KeyboardEvent) => {
      if (pressed.key === 'Escape') finish(false);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key, true);
  };

  /** Header props for one section: the drag start, and no collapse after a drag. */
  const headerProps = (id: string) => ({
    'data-section-head': id,
    onPointerDown: start(id),
    onClickCapture: (event: React.MouseEvent) => {
      if (!swallow.current) return;
      swallow.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  });

  const overlay =
    line &&
    createPortal(
      <Box
        data-testid="section-drop-line"
        aria-hidden
        sx={{
          position: 'fixed',
          top: line.top - 1,
          left: line.left,
          width: line.width,
          height: 2,
          bgcolor: 'primary.main',
          borderRadius: 1,
          pointerEvents: 'none',
          zIndex: (theme) => theme.zIndex.tooltip,
        }}
      />,
      document.body,
    );

  return { headerProps, overlay };
}
