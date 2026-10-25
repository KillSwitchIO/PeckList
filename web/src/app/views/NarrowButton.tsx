import {
  Badge,
  Box,
  Button,
  Checkbox,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Popover,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useState } from 'react';
import { visibleLists } from '../../core/lists.ts';
import { isNarrowed, NO_NARROWING, type Narrowing } from '../../core/narrowing.ts';
import { savedFiltersOf } from '../../core/savedFilters.ts';
import { visibleTags } from '../../core/tags.ts';
import type { Id } from '../../core/types.ts';
import { t } from '../i18n/i18n.ts';
import { FilterIcon } from '../icons/icons.tsx';
import { BottomSheet } from '../layout/BottomSheet.tsx';
import { listName } from '../lists/listName.ts';
import { useWorkspace } from '../store/hooks.ts';

export function NarrowButton({
  narrowing,
  onChange,
}: {
  narrowing: Narrowing;
  onChange: (next: Narrowing) => void;
}) {
  const workspace = useWorkspace();
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const on = isNarrowed(narrowing);
  const label = on ? t('narrow.buttonOn') : t('narrow.button');

  const toggle = (kind: keyof Narrowing, id: Id) => {
    const has = narrowing[kind].includes(id);
    onChange({
      ...narrowing,
      [kind]: has ? narrowing[kind].filter((each) => each !== id) : [...narrowing[kind], id],
    });
  };
  const group = (
    kind: keyof Narrowing,
    title: string,
    items: { id: Id; name: string; color?: string }[],
  ) =>
    items.length > 0 && (
      <List
        dense
        aria-label={title}
        subheader={
          <ListSubheader disableSticky sx={{ lineHeight: '32px', bgcolor: 'transparent' }}>
            {title}
          </ListSubheader>
        }
      >
        {items.map((item) => {
          const checked = narrowing[kind].includes(item.id);
          return (
            <ListItemButton
              key={item.id}
              role="menuitemcheckbox"
              aria-checked={checked}
              onClick={() => toggle(kind, item.id)}
              sx={{ py: 0 }}
            >
              <ListItemIcon sx={{ minWidth: 36 }}>
                <Checkbox edge="start" size="small" checked={checked} tabIndex={-1} disableRipple />
              </ListItemIcon>
              {item.color && (
                <Box
                  aria-hidden
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    bgcolor: item.color,
                    mr: 1,
                    flexShrink: 0,
                  }}
                />
              )}
              <ListItemText primary={item.name} slotProps={{ primary: { noWrap: true } }} />
            </ListItemButton>
          );
        })}
      </List>
    );

  const body = (
    <Box sx={{ width: phone ? '100%' : 300, maxHeight: phone ? '70dvh' : 440, overflowY: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', px: 2, pt: 1.5, pb: 0.5 }}>
        <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
          {t('narrow.title')}
        </Typography>
        <Button size="small" disabled={!on} onClick={() => onChange(NO_NARROWING)}>
          {t('narrow.clear')}
        </Button>
      </Box>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ px: 2 }}>
        {t('narrow.hint')}
      </Typography>
      {group(
        'lists',
        t('narrow.lists'),
        visibleLists(workspace).map((list) => ({
          id: list.id,
          name: listName(list, workspace),
          color: list.color,
        })),
      )}
      {group(
        'tags',
        t('narrow.tags'),
        visibleTags(workspace).map((tag) => ({ id: tag.id, name: tag.name, color: tag.color })),
      )}
      {group(
        'filters',
        t('narrow.filters'),
        savedFiltersOf(workspace).map((saved) => ({ id: saved.id, name: saved.name })),
      )}
    </Box>
  );

  return (
    <>
      <Tooltip title={label}>
        <IconButton
          aria-label={label}
          aria-haspopup="dialog"
          aria-pressed={on}
          onClick={(event) => setAnchor(event.currentTarget)}
          sx={on ? { color: 'primary.main' } : undefined}
        >
          <Badge color="primary" variant="dot" invisible={!on}>
            <FilterIcon />
          </Badge>
        </IconButton>
      </Tooltip>
      {phone ? (
        <BottomSheet open={anchor !== null} onClose={() => setAnchor(null)}>
          {body}
        </BottomSheet>
      ) : (
        <Popover
          open={anchor !== null}
          anchorEl={anchor}
          onClose={() => setAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          slotProps={{ paper: { role: 'dialog', 'aria-label': t('narrow.title') } }}
        >
          {body}
        </Popover>
      )}
    </>
  );
}
