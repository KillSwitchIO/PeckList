import { List, ListItemButton, ListItemIcon, ListItemText } from '@mui/material';
import { useNavigate } from 'react-router';
import { t } from '../i18n/i18n.ts';
import { Page } from '../layout/Page.tsx';
import { SIDEBAR_FOOTER, SIDEBAR_ITEMS } from '../layout/navigation.tsx';
import { SidebarLists } from '../lists/SidebarLists.tsx';

/** Phone-only hub for everything the bottom navigation has no room for. */
export function MoreView() {
  const navigate = useNavigate();
  const go = (path: string) => void navigate(path);
  const items = [...SIDEBAR_ITEMS, ...SIDEBAR_FOOTER].filter(
    (item) => !['/today', '/inbox', '/calendar', '/search'].includes(item.path),
  );
  return (
    <Page title={t('more.title')}>
      <List>
        {items.map((item) => (
          <ListItemButton key={item.path} onClick={() => go(item.path)}>
            <ListItemIcon>{item.icon}</ListItemIcon>
            <ListItemText primary={t(item.label)} />
          </ListItemButton>
        ))}
      </List>
      <SidebarLists onNavigate={go} />
    </Page>
  );
}
