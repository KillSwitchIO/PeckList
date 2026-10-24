import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import { Box, ButtonBase, Collapse, Typography } from '@mui/material';
import { useState, type HTMLAttributes, type ReactNode } from 'react';
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
  return (
    <Box component="section" sx={{ mt: 2 }}>
      <Box {...headerProps} sx={{ display: 'flex', alignItems: 'center', minHeight: 32 }}>
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
      <Collapse in={open} unmountOnExit>
        {children}
      </Collapse>
    </Box>
  );
}
