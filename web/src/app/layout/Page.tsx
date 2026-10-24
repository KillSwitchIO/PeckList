import { Typography } from '@mui/material';
import { useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { HeaderSlotContext } from './headerSlot.ts';

/**
 * A page inside the persistent shell. The shell (sidebar, header, navigation) is mounted once
 * and never rebuilt on navigation; a page only supplies its title, header actions and content.
 */
export function Page({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const slot = useContext(HeaderSlotContext);
  return (
    <>
      {slot &&
        createPortal(
          <>
            {/* A little smaller on phones, where header buttons share the row. */}
            <Typography
              variant="h1"
              component="h1"
              sx={{ flexGrow: 1, fontSize: { xs: '1.25rem', sm: '1.5rem' } }}
              noWrap
            >
              {title}
            </Typography>
            {actions}
          </>,
          slot,
        )}
      {children}
    </>
  );
}
