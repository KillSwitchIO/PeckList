import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import RadioButtonUncheckedRounded from '@mui/icons-material/RadioButtonUncheckedRounded';
import RemoveCircleRounded from '@mui/icons-material/RemoveCircleRounded';
import { Box, ButtonBase, Checkbox, Collapse, Typography } from '@mui/material';
import { useContext, useMemo, useState, type HTMLAttributes, type ReactNode } from 'react';
import type { Id } from '../../core/types.ts';
import { t } from '../i18n/i18n.ts';
import { SectionRowsContext, useBulkSelect, type SectionRows } from '../tasks/bulkSelect.ts';
import { setGroupOpen, useGroupOpen } from './collapsed.ts';

/**
 * A collapsible group of tasks: "⌄ Overdue 1 ........ Postpone". The header is a level-2
 * heading containing a toggle button; `actions` sit on the right of the header. With a
 * `groupKey`, folding it folds that group on every page (see collapsed.ts).
 */
export function GroupSection({
  groupKey,
  title,
  count,
  actions,
  defaultOpen = true,
  headerProps,
  children,
}: {
  /** What the group is ("overdue", "completed", "priority:3"), to stay folded across pages */
  groupKey?: string;
  title: string;
  count?: number;
  actions?: ReactNode;
  defaultOpen?: boolean;
  /** Extra props on the header row (a drag handle for sections). */
  headerProps?: HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, string>;
  children: ReactNode;
}) {
  const [local, setLocal] = useState(defaultOpen);
  const shared = useGroupOpen(groupKey, defaultOpen);
  const open = groupKey === undefined ? local : shared;
  const toggle = () =>
    groupKey === undefined ? setLocal(!open) : setGroupOpen(groupKey, !open, defaultOpen);
  // While picking many, the rows inside say so, and a circle here picks them all.
  const bulk = useBulkSelect();
  const outer = useContext(SectionRowsContext);
  const [rows, setRows] = useState<ReadonlySet<Id>>(new Set());
  const registry = useMemo<SectionRows>(
    () => ({
      add: (id) => {
        outer?.add(id);
        setRows((before) => (before.has(id) ? before : new Set(before).add(id)));
      },
      remove: (id) => {
        outer?.remove(id);
        setRows((before) => {
          if (!before.has(id)) return before;
          const next = new Set(before);
          next.delete(id);
          return next;
        });
      },
    }),
    [outer],
  );
  const selecting = bulk?.selecting ?? false;
  const held = [...rows];
  const pickedHere = held.filter((id) => bulk?.picked.has(id)).length;
  return (
    <Box component="section" sx={{ mt: 2 }}>
      <Box {...headerProps} sx={{ display: 'flex', alignItems: 'center', minHeight: 32 }}>
        {selecting && bulk && held.length > 0 && (
          <Checkbox
            size="small"
            checked={pickedHere === held.length}
            indeterminate={pickedHere > 0 && pickedHere < held.length}
            onChange={() => bulk.toggle(held, pickedHere < held.length)}
            icon={<RadioButtonUncheckedRounded />}
            checkedIcon={<CheckCircleRounded />}
            indeterminateIcon={<RemoveCircleRounded />}
            slotProps={{ input: { 'aria-label': t('bulk.selectSection', { title }) } }}
            sx={{ p: 0.5, ml: -0.5 }}
          />
        )}
        <Typography component="h2" variant="subtitle2" sx={{ flexGrow: 1, m: 0 }}>
          <ButtonBase
            onClick={toggle}
            aria-expanded={open}
            aria-label={count === undefined ? title : `${title} ${count}`}
            sx={{
              gap: 0.5,
              py: 0.5,
              pr: 1,
              borderRadius: 1,
              fontWeight: 600,
              typography: 'subtitle2',
            }}
          >
            <ExpandMoreRounded
              fontSize="small"
              sx={{
                color: 'text.secondary',
                transform: open ? 'none' : 'rotate(-90deg)',
                transition: 'transform 150ms',
                '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
              }}
            />
            {title}
            {count !== undefined && (
              <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400, ml: 0.75 }}>
                {count}
              </Box>
            )}
          </ButtonBase>
        </Typography>
        {actions}
      </Box>
      <SectionRowsContext.Provider value={registry}>
        {/* Folded rows stay while picking, so a section's circle still picks them. */}
        <Collapse in={open} unmountOnExit={!selecting}>
          {children}
        </Collapse>
      </SectionRowsContext.Provider>
    </Box>
  );
}
