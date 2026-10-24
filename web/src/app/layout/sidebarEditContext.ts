import { keyframes } from '@emotion/react';
import { createContext, useContext } from 'react';
import type { Id, SidebarLayout } from '../../core/types.ts';

/** Everything the sidebar's edit mode can change. */
export interface SidebarDraft {
  layout: SidebarLayout;
  lists: Id[];
  /** Tag ids in order (only the order among siblings matters). */
  tags: Id[];
  /** New names of tags moved under another parent (their subtags included). */
  tagNames: Record<Id, string>;
  /** The phone's bottom bar tabs, in order (edited on the More page). */
  bottomBar: string[];
}

export interface SidebarEdit {
  editing: boolean;
  /** The draft while editing, else what is saved. */
  current: SidebarDraft;
  /** The views that exist: built-in ones and saved filters. */
  views: string[];
  start: () => void;
  update: (change: (draft: SidebarDraft) => SidebarDraft) => void;
  cancel: () => void;
  reset: () => void;
  done: () => void;
  /** Save a layout change right away (opening or closing the More group). */
  saveLayout: (layout: SidebarLayout) => void;
  /** The New filter dialog (opened from the edit bar). */
  creatingFilter: boolean;
  setCreatingFilter: (open: boolean) => void;
}

export const SidebarEditContext = createContext<SidebarEdit | null>(null);

export function useSidebarEdit(): SidebarEdit {
  const edit = useContext(SidebarEditContext);
  if (!edit) throw new Error('useSidebarEdit outside SidebarEditProvider');
  return edit;
}

/** The small shake of rows while editing. */
export const wiggle = keyframes`
  from { transform: rotate(-0.3deg); }
  to { transform: rotate(0.3deg); }
`;

/** Row styles while editing: a staggered shake, and a lifted row while dragged. */
export function editingRowSx(editing: boolean, dragged: boolean, index: number) {
  return {
    userSelect: 'none' as const,
    touchAction: editing ? 'none' : 'pan-y',
    ...(editing &&
      !dragged && {
        animation: `${wiggle} 0.24s ${(index % 3) * 0.06}s ease-in-out infinite alternate`,
      }),
    ...(dragged && { bgcolor: 'action.selected', boxShadow: 3, zIndex: 1, cursor: 'grabbing' }),
    '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
  };
}
