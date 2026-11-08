import { Box, IconButton, Tooltip } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { MAX_TABS, toggleTab } from '../../core/bottomBar.ts';
import { t } from '../i18n/i18n.ts';
import { BottomBarIcon } from '../icons/icons.tsx';
import { useSidebarEdit } from './sidebarEditContext.ts';

/** How long "the bar is full" stays up after a tap. */
const FULL_NOTICE_MS = 3000;

/**
 * On a row of the More page's editor: puts the row on the phone's bottom bar or takes it off. On
 * the bar it is filled and shows which tab it is; tabs go on in the order they are added. On a
 * full bar a tap says so and changes nothing.
 */
export function BarButton({ id, name }: { id: string; name: string }) {
  const edit = useSidebarEdit();
  const [hover, setHover] = useState(false);
  const [fullShown, setFullShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!edit.editing || !edit.editsBar) return null;

  const tabs = edit.current.bottomBar;
  const at = tabs.indexOf(id);
  const on = at >= 0;
  const full = !on && tabs.length >= MAX_TABS;
  const fullText = t('bottomBar.full', { count: MAX_TABS });
  const title = fullShown
    ? fullText
    : on
      ? t('bottomBar.onSlot', { slot: at + 1 })
      : t('bottomBar.add');

  return (
    <>
      <Tooltip
        title={title}
        open={hover || fullShown}
        onOpen={() => setHover(true)}
        onClose={() => setHover(false)}
      >
        <IconButton
          size="small"
          aria-pressed={on}
          aria-label={t(on ? 'bottomBar.remove' : 'bottomBar.addNamed', { name })}
          {...(full ? { 'aria-disabled': true } : {})}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (full) {
              setFullShown(true);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => setFullShown(false), FULL_NOTICE_MS);
              return;
            }
            edit.update((draft) => ({ ...draft, bottomBar: toggleTab(draft.bottomBar, id) }));
          }}
          sx={{ color: on ? 'primary.main' : 'text.disabled', opacity: full ? 0.5 : 1 }}
        >
          <BottomBarIcon fontSize="small" tab={on ? at + 1 : undefined} />
        </IconButton>
      </Tooltip>
      {/* Read out when a tap finds the bar full. */}
      <Box component="span" role="status" sx={visuallyHidden}>
        {fullShown ? fullText : ''}
      </Box>
    </>
  );
}

const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;
