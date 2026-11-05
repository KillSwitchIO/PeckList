import { IconButton, Typography } from '@mui/material';
import { useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link as RouterLink } from 'react-router';
import { t } from '../i18n/i18n.ts';
import { ChevronLeftIcon } from '../icons/icons.tsx';
import { HeaderSlotContext } from './headerSlot.ts';

/**
 * A page inside the persistent shell. The shell (sidebar, header, navigation) is mounted once
 * and never rebuilt on navigation; a page only supplies its title, header actions and content.
 */
export function Page({
  title,
  actions,
  backTo,
  children,
}: {
  title: string;
  actions?: ReactNode;
  /** A page inside another: a back button to that one, before the title. */
  backTo?: string;
  children: ReactNode;
}) {
  const slot = useContext(HeaderSlotContext);
  return (
    <>
      {slot &&
        createPortal(
          <>
            {backTo && (
              <IconButton
                component={RouterLink}
                to={backTo}
                edge="start"
                aria-label={t('common.back')}
                sx={{ mr: 0.5 }}
              >
                <ChevronLeftIcon />
              </IconButton>
            )}
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
