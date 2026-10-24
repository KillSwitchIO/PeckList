import { Box, Button, IconButton, Toolbar, Tooltip } from '@mui/material';
import { t } from '../i18n/i18n.ts';
import { PlusIcon } from '../icons/icons.tsx';
import { useSidebarEdit } from './sidebarEditContext.ts';

/** Cancel, Reset, New filter and Done while the sidebar (or the phone's More page) is edited. */
export function SidebarEditBar() {
  const edit = useSidebarEdit();
  return (
    <Toolbar
      role="toolbar"
      aria-label={t('nav.editSidebar')}
      sx={{
        gap: 0.5,
        px: '8px !important',
        '& .MuiButton-root': { minWidth: 0, px: 1, whiteSpace: 'nowrap' },
      }}
    >
      <Button size="small" color="inherit" onClick={edit.cancel}>
        {t('common.cancel')}
      </Button>
      {/* Back to the default views, nothing hidden or pinned; Done still saves it. */}
      <Button size="small" color="inherit" onClick={edit.reset}>
        {t('nav.resetSidebar')}
      </Button>
      <Box sx={{ flexGrow: 1 }} />
      <Tooltip title={t('filter.new')}>
        <IconButton
          size="small"
          aria-label={t('filter.new')}
          onClick={() => edit.setCreatingFilter(true)}
        >
          <PlusIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Button size="small" variant="contained" disableElevation onClick={edit.done}>
        {t('common.done')}
      </Button>
    </Toolbar>
  );
}
