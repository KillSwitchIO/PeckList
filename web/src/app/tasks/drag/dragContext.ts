import { createContext, useContext, type PointerEvent as ReactPointerEvent } from 'react';
import type { Id, Task } from '../../../core/types.ts';

/** Indent per subtask level (matches the rows). */
export const DRAG_INDENT = 24;

export interface DragApi {
  /** Ids dimmed while dragging (the task and its subtasks) */
  dimmed: ReadonlySet<Id>;
  /** Pointer handlers for a row's main area; `onMenu` is the touch long-press without a drag. */
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
