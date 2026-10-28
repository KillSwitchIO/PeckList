import { Box, Divider, IconButton, Tooltip } from '@mui/material';
import { useNavigate } from 'react-router';
import { t } from '../i18n/i18n.ts';
import { EditIcon } from '../icons/icons.tsx';
import { Page } from '../layout/Page.tsx';
import { SidebarEditProvider } from '../layout/sidebarEdit.tsx';
import { SidebarEditBar } from '../layout/SidebarEditBar.tsx';
import { BottomBarEditor } from '../layout/BottomBarEditor.tsx';
import { useSidebarEdit } from '../layout/sidebarEditContext.ts';
import { SidebarViews } from '../layout/SidebarViews.tsx';
import { UpdateNotice } from '../layout/VersionStatus.tsx';
import { SidebarLists } from '../lists/SidebarLists.tsx';
import { SidebarTags } from '../tags/SidebarTags.tsx';

/**
 * Phone-only hub: the desktop sidebar's views, lists and tags, edited the same way (Edit, or hold
 * a row): reorder, hide, pin, then Done.
 */
export function MoreView() {
  return (
    <SidebarEditProvider>
      <MoreContent />
    </SidebarEditProvider>
  );
}

function MoreContent() {
  const navigate = useNavigate();
  const go = (path: string) => void navigate(path);
  const edit = useSidebarEdit();
  return (
    <Page
      title={t('more.title')}
      actions={
        !edit.editing && (
          <Tooltip title={t('nav.editSidebar')}>
            <IconButton aria-label={t('nav.editSidebar')} onClick={edit.start}>
              <EditIcon />
            </IconButton>
          </Tooltip>
        )
      }
    >
      {edit.editing && (
        <Box
          sx={{
            position: 'sticky',
            top: 56,
            zIndex: 2,
            mx: -2,
            mt: -2,
            mb: 1,
            bgcolor: 'background.default',
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <SidebarEditBar />
        </Box>
      )}
      <Box sx={{ mx: -2 }}>
        {edit.editing && (
          <>
            <BottomBarEditor />
            <Divider sx={{ mx: 2, my: 1 }} />
          </>
        )}
        <SidebarViews selected={false} onNavigate={go} flat />
        <Divider sx={{ mx: 2 }} />
        <SidebarLists onNavigate={go} />
        <SidebarTags onNavigate={go} />
      </Box>
      {/* Phones have no sidebar: the release notice sits at the end here (R-FB-148). */}
      <Box sx={{ mx: -1.5, mt: 2 }}>
        <UpdateNotice />
      </Box>
    </Page>
  );
}
