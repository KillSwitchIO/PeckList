import BrightnessAutoRounded from '@mui/icons-material/BrightnessAutoRounded';
import { popupOpen, typing } from '../hooks/keys.ts';
import DarkModeRounded from '@mui/icons-material/DarkModeRounded';
import LightModeRounded from '@mui/icons-material/LightModeRounded';
import MenuRounded from '@mui/icons-material/MenuRounded';
import {
  AppBar,
  BottomNavigation,
  BottomNavigationAction,
  Button,
  Dialog,
  Box,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { t } from '../i18n/i18n.ts';
import { purgeExpired } from '../../core/trash.ts';
import { useApply } from '../store/hooks.ts';

import { HeaderSlotContext } from './headerSlot.ts';
import { SidebarEditProvider } from './sidebarEdit.tsx';
import { useSidebarEdit } from './sidebarEditContext.ts';
import { PlusIcon } from '../icons/icons.tsx';
import { SidebarViews } from './SidebarViews.tsx';
import { ResizeHandle } from './ResizeHandle.tsx';
import { useDetailWidth } from './useDetailWidth.ts';
import { SidebarLists } from '../lists/SidebarLists.tsx';
import { SidebarTags } from '../tags/SidebarTags.tsx';
import { useTaskSelection } from '../tasks/selection.ts';
import { TaskDetail } from '../tasks/TaskDetail.tsx';
import { UndoToast } from '../tasks/UndoToast.tsx';
import { useThemeMode } from '../theme/themeMode.ts';
import {
  activeItem,
  BOTTOM_ITEMS,
  SIDEBAR_FOOTER,
  SIDEBAR_ITEMS,
  type NavItem,
} from './navigation.tsx';
import { SyncButton } from '../sync/SyncButton.tsx';

/** How often the trash is checked for things to erase. */
const PURGE_EVERY_MS = 6 * 3_600_000;

const DRAWER_WIDTH = 232;
// Details get room for notes: about two fifths of the window, within sensible bounds.
const DETAIL_WIDTH = 'clamp(440px, 40vw, 960px)';
// A dragged width stays within these: the panel keeps room for its fields, the list for its rows.
const DETAIL_MIN = 380;
const LIST_MIN = 360;

function ThemeToggle() {
  const { mode, cycleMode } = useThemeMode();
  const icon =
    mode === 'light' ? (
      <LightModeRounded />
    ) : mode === 'dark' ? (
      <DarkModeRounded />
    ) : (
      <BrightnessAutoRounded />
    );
  const label = t('theme.toggle', { mode: t(`theme.${mode}`) });
  return (
    <Tooltip title={label}>
      <IconButton onClick={cycleMode} aria-label={label}>
        {icon}
      </IconButton>
    </Tooltip>
  );
}

function NavList({
  items,
  selected,
  onSelect,
}: {
  items: NavItem[];
  selected: string | false;
  onSelect: (path: string) => void;
}) {
  return (
    <List dense>
      {items.map((item) => (
        <ListItemButton
          key={item.path}
          selected={selected === item.path}
          onClick={() => onSelect(item.path)}
        >
          <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
          <ListItemText primary={t(item.label)} />
        </ListItemButton>
      ))}
    </List>
  );
}

/** The sidebar's title row; while editing it holds Cancel, Reset and Done instead. */
function SidebarTitle() {
  const edit = useSidebarEdit();
  if (!edit.editing) {
    return (
      <Toolbar>
        <Typography variant="h2" component="div">
          {t('app.name')}
        </Typography>
      </Toolbar>
    );
  }
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

function Sidebar({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { pathname } = useLocation();
  const all = [...SIDEBAR_ITEMS, ...SIDEBAR_FOOTER];
  const selected = activeItem(all, pathname);
  return (
    <SidebarEditProvider>
      <Box
        component="nav"
        aria-label={t('app.name')}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          // Icons lift a whole pixel on hover: a light spring, nothing that pulls the eye. No
          // scaling, which blurs the strokes.
          '& .MuiListItemButton-root .MuiListItemIcon-root > *': {
            transition: 'transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1)',
          },
          '& .MuiListItemButton-root:hover .MuiListItemIcon-root > *': {
            transform: 'translateY(-2px)',
          },
          '@media (prefers-reduced-motion: reduce)': {
            '& .MuiListItemButton-root:hover .MuiListItemIcon-root > *': { transform: 'none' },
          },
        }}
      >
        <SidebarTitle />
        <SidebarViews selected={selected} onNavigate={onNavigate} />
        <Divider sx={{ mx: 2 }} />
        <Box sx={{ flexGrow: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          <SidebarLists onNavigate={onNavigate} />
          <SidebarTags onNavigate={onNavigate} />
        </Box>
        <NavList items={SIDEBAR_FOOTER} selected={selected} onSelect={onNavigate} />
      </Box>
    </SidebarEditProvider>
  );
}

/**
 * Responsive frame: permanent sidebar on desktop, temporary drawer on tablet,
 * bottom navigation on phones (vault: Design Spec, Layout). Mounted once as a layout route;
 * pages render into it with <Page>, so navigation never rebuilds the frame.
 */
export function AppShell() {
  const theme = useTheme();
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const isDesktop = useMediaQuery(theme.breakpoints.up('lg'), { noSsr: true });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { selectedId, close } = useTaskSelection();
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  // Details in the large full-screen view instead of the side panel (resets with the task).
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const expanded = selectedId !== null && expandedId === selectedId;
  const aside = useRef<HTMLElement | null>(null);
  const [detailWidth, setDetailWidth] = useDetailWidth(
    DETAIL_MIN,
    () => window.innerWidth - DRAWER_WIDTH - LIST_MIN,
  );

  // Escape closes the task details, unless a dialog, menu or picker takes it first.
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || popupOpen()) return;
      // Let a field being edited save itself (it commits on blur).
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, close]);

  // Things in the trash for more than 30 days are erased: at start, then every few hours.
  const apply = useApply();
  useEffect(() => {
    const purge = () => apply((ctx, ws) => purgeExpired(ctx, ws, Date.now()));
    purge();
    const timer = window.setInterval(purge, PURGE_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [apply]);

  // "/" jumps to search from anywhere but a text field (spec: Keyboard shortcuts).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.defaultPrevented || typing() || popupOpen()) return;
      event.preventDefault();
      void navigate('/search');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const go = (path: string) => {
    setDrawerOpen(false);
    void navigate(path);
  };

  const detail = selectedId ? (
    <TaskDetail
      key={selectedId}
      taskId={selectedId}
      onClose={close}
      expanded={expanded}
      {...(isPhone ? {} : { onToggleExpanded: () => setExpandedId(expanded ? null : selectedId) })}
    />
  ) : null;

  return (
    <Box sx={{ display: 'flex', minHeight: '100dvh' }}>
      {isDesktop ? (
        <Drawer
          variant="permanent"
          sx={{ width: DRAWER_WIDTH, flexShrink: 0, '& .MuiDrawer-paper': { width: DRAWER_WIDTH } }}
        >
          <Sidebar onNavigate={go} />
        </Drawer>
      ) : (
        !isPhone && (
          <Drawer
            variant="temporary"
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            sx={{ '& .MuiDrawer-paper': { width: DRAWER_WIDTH } }}
          >
            <Sidebar onNavigate={go} />
          </Drawer>
        )
      )}

      <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <AppBar position="sticky">
          <Toolbar sx={{ gap: 1 }}>
            {!isDesktop && !isPhone && (
              <IconButton
                edge="start"
                aria-label={t('nav.openMenu')}
                onClick={() => setDrawerOpen(true)}
              >
                <MenuRounded />
              </IconButton>
            )}
            <Box
              ref={setHeaderSlot}
              sx={{ display: 'flex', alignItems: 'center', gap: 1, flexGrow: 1, minWidth: 0 }}
            />
            <SyncButton />
            <ThemeToggle />
          </Toolbar>
        </AppBar>

        <Box sx={{ flexGrow: 1, display: 'flex', minHeight: 0 }}>
          <Box
            component="main"
            sx={{
              flexGrow: 1,
              minWidth: 0,
              px: { xs: 2, sm: 3 },
              py: 2,
              pb: isPhone ? 10 : 2,
              // Fills the space between the sidebar and the details panel, so the panel always
              // sits at the window's right edge (wide and ultrawide screens included).
            }}
          >
            <HeaderSlotContext.Provider value={headerSlot}>
              <Outlet />
            </HeaderSlotContext.Provider>
          </Box>
          {isDesktop && detail && !expanded && (
            <Box
              component="aside"
              ref={aside}
              sx={{
                width:
                  detailWidth === null
                    ? DETAIL_WIDTH
                    : `clamp(${DETAIL_MIN}px, ${detailWidth}px, calc(100vw - ${DRAWER_WIDTH + LIST_MIN}px))`,
                flexShrink: 0,
                borderLeft: 1,
                borderColor: 'divider',
                bgcolor: 'background.paper',
                position: 'sticky',
                top: 64,
                alignSelf: 'flex-start',
                // Full height, so the list and priority bar sits at the bottom.
                height: 'calc(100dvh - 64px)',
              }}
            >
              <ResizeHandle
                current={() => aside.current?.getBoundingClientRect().width ?? DETAIL_MIN}
                onResize={setDetailWidth}
                onReset={() => setDetailWidth(null)}
              />
              {detail}
            </Box>
          )}
        </Box>

        <Dialog
          open={detail !== null && expanded}
          onClose={() => setExpandedId(null)}
          fullWidth
          maxWidth="md"
          slotProps={{ paper: { sx: { height: '88dvh', backgroundImage: 'none' } } }}
        >
          {expanded && detail}
        </Dialog>

        {!isDesktop && (
          <Drawer
            anchor={isPhone ? 'bottom' : 'right'}
            open={detail !== null && !expanded}
            onClose={close}
            slotProps={{
              paper: {
                sx: isPhone
                  ? { height: '92dvh', borderTopLeftRadius: 16, borderTopRightRadius: 16 }
                  : { width: 'min(560px, 92vw)' },
              },
            }}
          >
            {!expanded && detail}
          </Drawer>
        )}

        <UndoToast bottomOffset={isPhone ? 56 : 0} />

        {isPhone && (
          <BottomNavigation
            component="nav"
            aria-label={t('app.name')}
            showLabels
            value={activeItem(BOTTOM_ITEMS, pathname)}
            onChange={(_, path: string) => go(path)}
            sx={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              pb: 'env(safe-area-inset-bottom)',
            }}
          >
            {BOTTOM_ITEMS.map((item) => (
              <BottomNavigationAction
                key={item.path}
                value={item.path}
                label={t(item.label)}
                icon={item.icon}
              />
            ))}
          </BottomNavigation>
        )}
      </Box>
    </Box>
  );
}
