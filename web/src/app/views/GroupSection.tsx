import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import { Box, ButtonBase, Collapse, Typography } from '@mui/material';
import { useState, type ReactNode } from 'react';

/**
 * A collapsible group of tasks: "⌄ Overdue 1 ........ Postpone". The header is a level-2
 * heading containing a toggle button; `actions` sit on the right of the header.
 */
export function GroupSection({
  title,
  count,
  actions,
  defaultOpen = true,
  children,
}: {
  title: string;
  count?: number;
  actions?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Box component="section" sx={{ mt: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', minHeight: 32 }}>
        <Typography component="h2" variant="subtitle2" sx={{ flexGrow: 1, m: 0 }}>
          <ButtonBase
            onClick={() => setOpen((value) => !value)}
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
