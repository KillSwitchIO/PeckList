import MoreHorizRounded from '@mui/icons-material/MoreHorizRounded';
import { Box, Button, IconButton, Popover, Typography, useTheme } from '@mui/material';
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { moveTab } from '../../core/bottomBar.ts';
import { claimTouchesRef } from '../dnd/claimTouch.ts';
import { followReorder } from '../dnd/followReorder.ts';
import { t } from '../i18n/i18n.ts';
import { CloseIcon, DragHandleIcon } from '../icons/icons.tsx';
import { useTabs, type Tab } from './bottomTabs.tsx';

/** The bar as it will look: each tab's mark and short name, then More, as the phone draws it. */
function BarPreview({ tabs, more, current }: { tabs: Tab[]; more: Tab; current: string }) {
  return (
    <Box
      role="group"
      aria-label={t('bottomBar.preview')}
      sx={{
        display: 'flex',
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        bgcolor: 'background.paper',
        py: 0.75,
      }}
    >
      {[...tabs, more].map((tab) => (
        <Box
          key={tab.id}
          aria-hidden
          sx={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 0.25,
            color: tab.id === current ? 'primary.main' : 'text.secondary',
            '& svg': { fontSize: 22 },
          }}
        >
          {tab.icon}
          <Typography
            variant="caption"
            noWrap
            sx={{ maxWidth: '100%', px: 0.25, fontSize: '0.7rem', color: 'inherit' }}
          >
            {tab.label}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

/**
 * The order of the bottom bar's tabs (PL-149, Ben), from a tab's numbered button in the More
 * page's editor: a preview of the bar, and the tabs in order to drag by their grips (or move with
 * the arrow keys on one) and take off. Done hands back the new order; Cancel or a tap outside
 * changes nothing. `current` is the tab whose button opened it, marked in both.
 */
export function BarOrderPopover({
  anchor,
  tabs,
  current,
  onDone,
  onClose,
}: {
  anchor: HTMLElement;
  tabs: readonly string[];
  current: string;
  onDone: (tabs: string[]) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [order, setOrder] = useState<string[]>([...tabs]);
  const shown = useTabs(order);
  const rows = useRef<(HTMLElement | null)[]>([]);
  const more: Tab = { id: 'more', path: '/more', label: t('nav.more'), icon: <MoreHorizRounded /> };
  // Rows are `shown`, which leaves out a tab it can't describe (a list a sync just deleted), so
  // a move goes by the tabs' ids, never their places in `order`.
  const moveShown = (from: number, to: number) => {
    const fromId = shown[from]?.id;
    const toId = shown[to]?.id;
    setOrder((now) => {
      const at = fromId === undefined ? -1 : now.indexOf(fromId);
      const into = toId === undefined ? -1 : now.indexOf(toId);
      return at < 0 || into < 0 ? now : moveTab(now, at, into);
    });
  };

  const drag = (event: PointerEvent<Element>, index: number) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const elements = rows.current.slice(0, shown.length).filter((row): row is HTMLElement => !!row);
    if (elements.length < 2) return;
    followReorder(event, elements, index, (to) => moveShown(index, to), theme.palette.primary.main);
  };
  const nudge = (event: KeyboardEvent<Element>, index: number) => {
    const by = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    const to = index + by;
    if (!by || to < 0 || to >= shown.length) return;
    event.preventDefault();
    moveShown(index, to);
    // The grip follows its tab, so the next press moves it on.
    requestAnimationFrame(() =>
      rows.current[to]?.querySelector<HTMLElement>('[data-drag-handle]')?.focus(),
    );
  };

  return (
    <Popover
      open
      anchorEl={anchor}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{
        paper: {
          role: 'dialog',
          'aria-label': t('bottomBar.orderTitle'),
          sx: { width: 'min(340px, calc(100vw - 32px))', p: 2 },
        },
      }}
    >
      <Typography variant="subtitle2" component="h2" sx={{ mb: 1.5 }}>
        {t('bottomBar.orderTitle')}
      </Typography>
      <BarPreview tabs={shown} more={more} current={current} />
      <Box component="ol" sx={{ listStyle: 'none', p: 0, m: 0, mt: 1.5 }}>
        {shown.map((tab, index) => (
          <Box
            component="li"
            key={tab.id}
            ref={(row: HTMLElement | null) => {
              rows.current[index] = row;
            }}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              minHeight: 40,
              borderRadius: 1,
              bgcolor: tab.id === current ? 'action.selected' : undefined,
            }}
          >
            <Box
              component="span"
              ref={claimTouchesRef}
              data-drag-handle=""
              role="button"
              tabIndex={0}
              aria-label={t('bottomBar.moveNamed', { name: tab.fullLabel ?? tab.label })}
              onPointerDown={(event) => drag(event, index)}
              onKeyDown={(event) => nudge(event, index)}
              sx={{
                display: 'inline-flex',
                color: 'text.disabled',
                p: 1,
                cursor: 'grab',
                touchAction: 'none',
                borderRadius: 1,
                '&:focus-visible': { outline: 2, outlineColor: 'primary.main' },
              }}
            >
              <DragHandleIcon fontSize="small" />
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ width: 12 }}>
              {index + 1}
            </Typography>
            <Box
              sx={{ display: 'inline-flex', color: 'text.secondary', '& svg': { fontSize: 20 } }}
            >
              {tab.icon}
            </Box>
            <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
              {tab.fullName ?? tab.fullLabel ?? tab.label}
            </Typography>
            <IconButton
              size="small"
              aria-label={t('bottomBar.remove', { name: tab.fullLabel ?? tab.label })}
              onClick={() => setOrder((now) => now.filter((id) => id !== tab.id))}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        ))}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1.5 }}>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" disableElevation onClick={() => onDone(order)}>
          {t('common.done')}
        </Button>
      </Box>
    </Popover>
  );
}
