import { Box, ButtonBase, ListSubheader } from '@mui/material';
import type { ReactNode } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from '../icons/icons.tsx';

/** A sidebar section heading (Lists, Tags) that folds its section; `actions` sit on the right. */
export function SectionHeader({
  title,
  open,
  onToggle,
  actions,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  actions?: ReactNode;
}) {
  return (
    <ListSubheader sx={{ bgcolor: 'transparent', display: 'flex', alignItems: 'center', pr: 1 }}>
      <ButtonBase
        aria-expanded={open}
        onClick={onToggle}
        sx={{
          flexGrow: 1,
          justifyContent: 'flex-start',
          gap: 0.5,
          ml: -0.5,
          px: 0.5,
          borderRadius: 1,
          font: 'inherit',
          color: 'inherit',
          '& .chevron': { opacity: open ? 0 : 1, transition: 'opacity 120ms' },
          '&:hover .chevron, &:focus-visible .chevron': { opacity: 1 },
        }}
      >
        <Box component="span">{title}</Box>
        {open ? (
          <ChevronDownIcon className="chevron" sx={{ fontSize: 16 }} />
        ) : (
          <ChevronRightIcon className="chevron" sx={{ fontSize: 16 }} />
        )}
      </ButtonBase>
      {actions}
    </ListSubheader>
  );
}
