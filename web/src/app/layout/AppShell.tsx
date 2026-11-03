import { popupOpen } from '../hooks/keys.ts';
import { ShortcutsDialog } from '../shortcuts/ShortcutsDialog.tsx';
import { useShortcuts } from '../shortcuts/useShortcuts.ts';
import MenuRounded from '@mui/icons-material/MenuRounded';
import {
  AppBar,
  BottomNavigation,
  BottomNavigationAction,
  Dialog,
  Box,
  Link,
  Divider,
  Drawer,
  Fab,
  IconButton,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { t } from '../i18n/i18n.ts';
import { expandAddTask } from '../tasks/focusAddTask.ts';
import { PullToRefresh } from '../sync/PullToRefresh.tsx';
import { SyncNoticeToast } from '../sync/SyncNoticeToast.tsx';
import { ReminderScheduler } from '../reminders/ReminderScheduler.tsx';
import { NotificationsProvider } from '../notifications/NotificationsProvider.tsx';
import { purgeExpired } from '../../core/trash.ts';
import { flattenSections } from '../../core/lists.ts';
import { canEditList } from '../../core/sharing.ts';
import { useApply, useStoreState } from '../store/hooks.ts';

import { HeaderSlotContext } from './headerSlot.ts';
import { SidebarEditProvider } from './sidebarEdit.tsx';
import { useSidebarEdit } from './sidebarEditContext.ts';
import { PlusIcon } from '../icons/icons.tsx';
import { SidebarEditBar } from './SidebarEditBar.tsx';
import { SidebarViews } from './SidebarViews.tsx';
import { ResizeHandle } from './ResizeHandle.tsx';
import { useDetailWidth } from './useDetailWidth.ts';
import { SidebarLists } from '../lists/SidebarLists.tsx';
import { SidebarTags } from '../tags/SidebarTags.tsx';
import { useTaskSelection } from '../tasks/selection.ts';
import { TaskDetail } from '../tasks/TaskDetail.tsx';
import { settleDraft } from '../tasks/drafts.ts';
import { UndoToast } from '../tasks/UndoToast.tsx';
import { ProfileButton } from './ProfileButton.tsx';
import { APP_VERSION_LABEL, CHANGELOG_URL } from './appVersion.ts';
import { MiniCalendar } from './MiniCalendar.tsx';
import { useToday } from '../hooks/useToday.ts';
import { dayPath } from '../views/dayLabels.ts';
import { useAppliedTimeZone } from './useAppliedTimeZone.ts';
import { activeItem, SIDEBAR_ITEMS } from './navigation.tsx';
import { useBottomTabs } from './bottomTabs.tsx';
import { BulkBar } from '../tasks/BulkBar.tsx';
import { ProviderPhotoSync } from '../friends/ProviderPhotoSync.tsx';
import { BulkSelectProvider } from '../tasks/BulkSelectProvider.tsx';
import { useBulkSelect } from '../tasks/bulkSelect.ts';
import { TwoLineRowsContext, useNarrow } from './rowLayout.ts';
import { SyncButton } from '../sync/SyncButton.tsx';
import { BottomSheet } from './BottomSheet.tsx';
import { NotificationLinks } from '../notifications/NotificationLinks.tsx';
import { EasterEggs } from '../fun/EasterEggs.tsx';
import { useHoldToHatch } from '../fun/useHoldToHatch.ts';
import { UpdateNotice } from './VersionStatus.tsx';
import { PeekSidebar } from './PeekSidebar.tsx';
import { noteArrival } from '../views/emptyMarkPlays.ts';

/** How often the trash is checked for things to erase. */
const PURGE_EVERY_MS = 6 * 3_600_000;

const DRAWER_WIDTH = 232;
const COLLAPSED_KEY = 'pecklist.sidebarCollapsed';

/** Whether the desktop sidebar is folded away (per device). */
function useSidebarCollapsed(): [boolean, (collapsed: boolean) => void] {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const set = (next: boolean) => {
    setCollapsed(next);
    try {
      if (next) localStorage.setItem(COLLAPSED_KEY, 'true');
      else localStorage.removeItem(COLLAPSED_KEY);
    } catch {
      // Private windows: it stays as it is until the page reloads.
    }
  };
  return [collapsed, set];
}
// Details get room for notes: about two fifths of the window, within sensible bounds.
const DETAIL_WIDTH = 'clamp(440px, 40vw, 960px)';
// A dragged width stays within these: the panel keeps room for its fields, the list for its rows.
const DETAIL_MIN = 380;
const LIST_MIN = 360;

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
  return <SidebarEditBar />;
}

function Sidebar({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { pathname } = useLocation();
  const selected = activeItem(SIDEBAR_ITEMS, pathname);
  const today = useToday();
  const openDay =
    /^\/day\/(\d{4}-\d{2}-\d{2})$/.exec(pathname)?.[1] ?? (pathname === '/today' ? today : null);
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
        {/* Views, lists and tags scroll as one, so a short window still shows the lists. */}
        <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
          <SidebarViews selected={selected} onNavigate={onNavigate} />
          <Divider sx={{ mx: 2 }} />
          <SidebarLists onNavigate={onNavigate} />
          <SidebarTags onNavigate={onNavigate} />
        </Box>
        <MiniCalendar selected={openDay} onPick={(date) => onNavigate(dayPath(date, today))} />
        <UpdateNotice />
        <Link
          href={CHANGELOG_URL}
          target="_blank"
          rel="noreferrer"
          variant="caption"
          color="text.disabled"
          underline="hover"
          aria-label={t('app.versionLink', { version: APP_VERSION_LABEL })}
          sx={{ px: 2.5, pb: 1, alignSelf: 'flex-start', fontSize: 11 }}
        >
          {APP_VERSION_LABEL}
        </Link>
      </Box>
    </SidebarEditProvider>
  );
}

/**
 * An Escape something inside already used (the notes leave editing on the first one): the panel
 * or dialog around it stays open until the next one, as on desktop.
 */
function handledInside(event: unknown, reason: string): boolean {
  return (
    reason === 'escapeKeyDown' &&
    typeof event === 'object' &&
    event !== null &&
    'defaultPrevented' in event &&
    event.defaultPrevented === true
  );
}

/** Pages without tasks to add, where the phone's + button stays away. */
// Due dates has no add field, and its bulk bar sits where the button would; on More it
// covered the rows being edited.
const NO_ADD_BUTTON = ['/settings', '/admin', '/friends', '/f/', '/search', '/due', '/more'];

/**
 * Responsive frame: permanent sidebar on desktop, temporary drawer on tablet,
 * bottom navigation on phones (vault: Design Spec, Layout). Mounted once as a layout route;
 * pages render into it with <Page>, so navigation never rebuilds the frame.
 */
function AppFrame() {
  const theme = useTheme();
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const bulk = useBulkSelect();
  const bottomTabs = useBottomTabs();
  const [mainElement, setMainElement] = useState<HTMLElement | null>(null);
  const narrowMain = useNarrow(mainElement);
  const isDesktop = useMediaQuery(theme.breakpoints.up('lg'), { noSsr: true });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const sidebarShown = isDesktop && !collapsed;
  const drawerWidth = sidebarShown ? DRAWER_WIDTH : 0;
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // Pages arrived at, for the empty views' mark: it plays once per arrival (R-FB-152).
  noteArrival(pathname);
  const { selectedId, close, full, leaveFull } = useTaskSelection();
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  // Details in the large full-screen view instead of the side panel (resets with the task).
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const expanded = selectedId !== null && (expandedId === selectedId || full);
  const aside = useRef<HTMLElement | null>(null);
  const [detailWidth, setDetailWidth] = useDetailWidth(
    DETAIL_MIN,
    () => window.innerWidth - drawerWidth - LIST_MIN,
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

  // Sections were dropped (PL-011): what old data has, or an older app on another device still
  // syncs in, folds into its lists. Lists this person may not change stay as they are.
  const hasSections = useStoreState(
    (state) =>
      state.workspace !== null &&
      (state.workspace.entities.sections.some((section) => section.deletedAt === null) ||
        state.workspace.entities.tasks.some(
          (task) => task.sectionId !== null && task.deletedAt === null,
        )),
  );
  useEffect(() => {
    if (!hasSections) return;
    apply((ctx, ws) => flattenSections(ctx, ws, (listId) => canEditList(ws, ctx.userId, listId)));
  }, [hasSections, apply]);

  // A blank task from the quick add bar's expand button goes again once it is closed still empty.
  const shownTask = useRef(selectedId);
  useEffect(() => {
    const previous = shownTask.current;
    shownTask.current = selectedId;
    if (previous && previous !== selectedId) apply((ctx, ws) => settleDraft(ctx, ws, previous));
  }, [selectedId, apply]);

  // Keyboard shortcuts everywhere ("?" lists them).
  const shortcuts = useShortcuts();
  // Pages start over when the time zone changes, so every date is worked out again in it.
  const timeZone = useAppliedTimeZone();

  const go = (path: string) => {
    setDrawerOpen(false);
    void navigate(path);
  };

  const dogHold = useHoldToHatch('dog', 3000);
  const asideWidth =
    detailWidth === null
      ? DETAIL_WIDTH
      : `clamp(${DETAIL_MIN}px, ${detailWidth}px, calc(100vw - ${drawerWidth + LIST_MIN}px))`;

  const detail = selectedId ? (
    <TaskDetail
      key={selectedId}
      taskId={selectedId}
      onClose={close}
      expanded={expanded}
      {...(isPhone
        ? {}
        : {
            onToggleExpanded: () => {
              if (expanded && full) leaveFull();
              setExpandedId(expanded ? null : selectedId);
            },
          })}
    />
  ) : null;

  return (
    <Box sx={{ display: 'flex', minHeight: '100dvh' }}>
      {sidebarShown ? (
        <Drawer
          variant="permanent"
          sx={{ width: DRAWER_WIDTH, flexShrink: 0, '& .MuiDrawer-paper': { width: DRAWER_WIDTH } }}
        >
          <Sidebar onNavigate={go} />
        </Drawer>
      ) : (
        !isPhone &&
        !isDesktop && (
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
      {/* Hidden on a desktop: the mouse at the left edge brings it out (R-FB-149). */}
      {isDesktop && collapsed && (
        <PeekSidebar width={DRAWER_WIDTH}>
          <Sidebar onNavigate={go} />
        </PeekSidebar>
      )}

      <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <AppBar position="sticky">
          <Toolbar sx={{ gap: 1 }}>
            {!isPhone && (
              <Tooltip
                title={
                  isDesktop
                    ? t(collapsed ? 'nav.showSidebar' : 'nav.hideSidebar')
                    : t('nav.openMenu')
                }
              >
                <IconButton
                  edge="start"
                  aria-label={
                    isDesktop
                      ? t(collapsed ? 'nav.showSidebar' : 'nav.hideSidebar')
                      : t('nav.openMenu')
                  }
                  aria-expanded={isDesktop ? !collapsed : drawerOpen}
                  onClick={() => (isDesktop ? setCollapsed(!collapsed) : setDrawerOpen(true))}
                >
                  <MenuRounded />
                </IconButton>
              </Tooltip>
            )}
            <Box
              ref={setHeaderSlot}
              sx={{ display: 'flex', alignItems: 'center', gap: 1, flexGrow: 1, minWidth: 0 }}
            />
            <SyncButton />
            <ProfileButton onShortcuts={shortcuts.openHelp} />
          </Toolbar>
        </AppBar>

        <Box sx={{ flexGrow: 1, display: 'flex', minHeight: 0 }}>
          <Box
            component="main"
            key={timeZone}
            ref={setMainElement}
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
              <TwoLineRowsContext.Provider value={isPhone || narrowMain}>
                {/* A page loading on first visit (R-FB-94): the shell stays, the page fills in. */}
                <Suspense fallback={null}>
                  <Outlet />
                </Suspense>
              </TwoLineRowsContext.Provider>
            </HeaderSlotContext.Provider>
          </Box>
          {isDesktop && detail && !expanded && (
            <Box
              component="aside"
              ref={aside}
              sx={{
                width: asideWidth,
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
          onClose={(event, reason) => {
            if (handledInside(event, reason)) return;
            // A phone has no smaller view to fall back to: closing the full view closes the task
            // (R-FB-110).
            if (isPhone) {
              close();
              return;
            }
            if (full) leaveFull();
            setExpandedId(null);
          }}
          fullWidth
          maxWidth="md"
          // On a phone the full view is the whole screen, bigger than the task sheet (R-FB-110).
          fullScreen={isPhone}
          slotProps={{
            paper: { sx: { ...(isPhone ? {} : { height: '88dvh' }), backgroundImage: 'none' } },
          }}
        >
          {expanded && detail}
        </Dialog>

        {isPhone && (
          <BottomSheet
            open={detail !== null && !expanded}
            onClose={(event, reason) => {
              if (!handledInside(event, reason ?? '')) close();
            }}
            paperSx={{ height: '92dvh' }}
          >
            {!expanded && detail}
          </BottomSheet>
        )}

        {!isDesktop && !isPhone && (
          <Drawer
            anchor="right"
            open={detail !== null && !expanded}
            onClose={(event, reason) => {
              if (!handledInside(event, reason)) close();
            }}
            slotProps={{ paper: { sx: { width: 'min(560px, 92vw)' } } }}
          >
            {!expanded && detail}
          </Drawer>
        )}

        {/* Every screen size (R-FB-98); beside the task panel on a desktop, hidden behind the
            others while one is open. */}
        {(isDesktop ? !expanded : detail === null) &&
          !bulk?.selecting &&
          !NO_ADD_BUTTON.some((path) => pathname.startsWith(path)) && (
            <Fab
              color="primary"
              aria-label={t('shortcut.addTask')}
              // Held for 3 seconds, a dog comes to nap on it (R-FB-122).
              {...dogHold.handlers}
              onClick={() => {
                if (dogHold.swallowed()) return;
                // The new task screen, with the page's defaults; on a page with no add field,
                // the Inbox's (R-FB-74).
                if (expandAddTask()) return;
                go('/inbox');
                setTimeout(expandAddTask, 0);
              }}
              sx={{
                position: 'fixed',
                right: isDesktop && detail ? `calc(${asideWidth} + 24px)` : isPhone ? 16 : 24,
                bottom: isPhone ? 'calc(52px + 16px + env(safe-area-inset-bottom))' : 24,
                zIndex: (theme) => theme.zIndex.appBar,
              }}
            >
              <PlusIcon />
            </Fab>
          )}

        {/* On a phone, above the bottom navigation and the + button. */}
        <UndoToast bottomOffset={isPhone ? 52 + 72 : 0} wideBottomOffset={72} />
        <SyncNoticeToast />
        <PullToRefresh />
        <ReminderScheduler />
        <NotificationLinks />
        <EasterEggs />
        <ProviderPhotoSync />
        <ShortcutsDialog open={shortcuts.helpOpen} onClose={shortcuts.closeHelp} />

        {/* Picking many: the actions take the bottom tabs' place (or float, on a big screen). */}
        <BulkBar phone={isPhone} />
        {isPhone && !bulk?.selecting && (
          <BottomNavigation
            component="nav"
            aria-label={t('app.name')}
            showLabels
            value={activeItem(bottomTabs, pathname)}
            onChange={(_, path: string) => go(path)}
            sx={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              pb: 'env(safe-area-inset-bottom)',
            }}
          >
            {bottomTabs.map((tab) => (
              <BottomNavigationAction
                key={tab.id}
                value={tab.path}
                label={tab.label}
                icon={tab.icon}
              />
            ))}
          </BottomNavigation>
        )}
      </Box>
    </Box>
  );
}

/** The frame, with my notifications at hand for the profile button and the notifications page. */
export function AppShell() {
  return (
    <NotificationsProvider>
      <BulkSelectProvider>
        <AppFrame />
      </BulkSelectProvider>
    </NotificationsProvider>
  );
}
