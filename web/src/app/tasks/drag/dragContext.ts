import { createContext, useContext, type PointerEvent as ReactPointerEvent } from 'react';
import type { Id, Task } from '../../../core/types.ts';

/** Indent per subtask level (matches the rows). */
export const DRAG_INDENT = 24;

/** A finger held still this long on a row arms its drag (and is no longer a row swipe). */
export const DRAG_HOLD_MS = 450;
/** A finger that moves this far before the hold has armed is a scroll or a swipe, never the drag. */
export const DRAG_START_PX = 6;

export interface DragApi {
  /** Ids dimmed while dragging (the task and its subtasks) */
  dimmed: ReadonlySet<Id>;
  /** Pointer handlers for a row's main area; `onMenu` is a touch hold on its checkbox, let go without a drag. */
  gesture: (
    task: Task,
    depth: number,
    onMenu: (point: { top: number; left: number }) => void,
  ) => {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onClickCapture: (event: { preventDefault: () => void; stopPropagation: () => void }) => void;
  };
}

export const DragContext = createContext<DragApi | null>(null);

/** The drag of the list around, if rows here can be dragged. */
export function useTaskDrag(): DragApi | null {
  return useContext(DragContext);
}
