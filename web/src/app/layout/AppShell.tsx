import BrightnessAutoRounded from '@mui/icons-material/BrightnessAutoRounded';
import DarkModeRounded from '@mui/icons-material/DarkModeRounded';
import LightModeRounded from '@mui/icons-material/LightModeRounded';
import MenuRounded from '@mui/icons-material/MenuRounded';
import {
  AppBar,
  BottomNavigation,
  BottomNavigationAction,
  Box,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { t } from '../i18n/i18n.ts';
import { useThemeMode } from '../theme/themeMode.ts';
import {
  activeItem,
  BOTTOM_ITEMS,
  SIDEBAR_FOOTER,
  SIDEBAR_ITEMS,
  type NavItem,
} from './navigation.tsx';

const DRAWER_WIDTH = 272;

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

function Sidebar({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { pathname } = useLocation();
  const all = [...SIDEBAR_ITEMS, ...SIDEBAR_FOOTER];
  const selected = activeItem(all, pathname);
  return (
    <Box
      component="nav"
      aria-label={t('app.name')}
      sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      <Toolbar>
        <Typography variant="h2" component="div">
          {t('app.name')}
        </Typography>
      </Toolbar>
      <NavList items={SIDEBAR_ITEMS} selected={selected} onSelect={onNavigate} />
      <Divider sx={{ mx: 2 }} />
      <List
        dense
        subheader={<ListSubheader sx={{ bgcolor: 'transparent' }}>{t('nav.lists')}</ListSubheader>}
      />
      <List
        dense
        subheader={<ListSubheader sx={{ bgcolor: 'transparent' }}>{t('nav.tags')}</ListSubheader>}
      />
      <Box sx={{ flexGrow: 1 }} />
      <NavList items={SIDEBAR_FOOTER} selected={selected} onSelect={onNavigate} />
    </Box>
  );
}

/**
 * Responsive frame: permanent sidebar on desktop, temporary drawer on tablet,
 * bottom navigation on phones (vault: Design Spec, Layout).
 */
export function AppShell({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const isDesktop = useMediaQuery(theme.breakpoints.up('lg'), { noSsr: true });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const go = (path: string) => {
    setDrawerOpen(false);
    void navigate(path);
  };

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
            <Typography variant="h1" component="h1" sx={{ flexGrow: 1 }}>
              {title}
            </Typography>
            <ThemeToggle />
          </Toolbar>
        </AppBar>

        <Box
          component="main"
          sx={{ flexGrow: 1, px: { xs: 2, sm: 3 }, py: 2, pb: isPhone ? 10 : 2 }}
        >
          {children}
        </Box>

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
