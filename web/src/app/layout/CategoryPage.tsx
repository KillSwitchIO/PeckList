import {
  Box,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router';
import { ChevronRightIcon } from '../icons/icons.tsx';
import { Page } from './Page.tsx';

export interface PageCategory {
  /** The last part of its address: `<base>/<id>`. */
  id: string;
  label: string;
  icon: ReactNode;
  /** A line under its name in the phone's list. */
  hint?: string;
  /** Starts a named group in the list. */
  heading?: string;
  /** Left out of the list, but its address still opens it (it may be about to appear). */
  hidden?: boolean;
  content: () => ReactNode;
}

/** Where the list stops when the page scrolls: under the app's header. */
const HEADER_AND_GAP = 81;

function CategoryList({
  title,
  base,
  categories,
  selected,
  phone,
}: {
  title: string;
  base: string;
  categories: PageCategory[];
  selected: string | null;
  phone: boolean;
}) {
  return (
    <List component="nav" aria-label={title} disablePadding sx={phone ? { mx: -1 } : {}}>
      {categories
        .filter((category) => !category.hidden)
        .map((category) => (
          <Box key={category.id}>
            {category.heading && (
              <ListSubheader
                disableSticky
                sx={{
                  bgcolor: 'transparent',
                  lineHeight: 2,
                  mt: 1.5,
                  px: 1,
                  typography: 'caption',
                }}
              >
                {category.heading}
              </ListSubheader>
            )}
            <ListItemButton
              component={RouterLink}
              to={`${base}/${category.id}`}
              selected={category.id === selected}
              {...(category.id === selected ? { 'aria-current': 'page' } : {})}
              sx={{ borderRadius: 2, px: 1, py: phone ? 1.25 : 0.75, mb: 0.25 }}
            >
              <ListItemIcon sx={{ minWidth: 36, color: 'text.secondary' }}>
                {category.icon}
              </ListItemIcon>
              <ListItemText
                primary={category.label}
                {...(phone && category.hint ? { secondary: category.hint } : {})}
                sx={{ my: 0 }}
              />
              {phone && <ChevronRightIcon fontSize="small" sx={{ color: 'text.secondary' }} />}
            </ListItemButton>
          </Box>
        ))}
    </List>
  );
}

/**
 * A page of many settings, split by subject (spec: PL-128). Wide, the subjects stand in a list
 * beside the one that is open, and the first opens by itself. On a phone the page is that list,
 * and each subject is a page of its own with a way back. Settings and Admin both use it.
 */
export function CategoryPage({
  title,
  base,
  categories,
  current,
  phoneTop,
}: {
  title: string;
  /** The page's address; a subject's is `<base>/<id>`. */
  base: string;
  categories: PageCategory[];
  current: string | undefined;
  /** Above the list on a phone. */
  phoneTop?: ReactNode;
}) {
  const theme = useTheme();
  const wide = useMediaQuery(theme.breakpoints.up('md'), { noSsr: true });
  const asked = categories.find((category) => category.id === current);
  if (!wide) {
    if (!asked)
      return (
        <Page title={title}>
          {phoneTop}
          <CategoryList title={title} base={base} categories={categories} selected={null} phone />
        </Page>
      );
    return (
      <Page title={asked.label} backTo={base}>
        {asked.content()}
      </Page>
    );
  }
  const open = asked ?? categories.find((category) => !category.hidden) ?? categories[0];
  return (
    <Page title={title}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: { md: 3, lg: 5 } }}>
        <Box sx={{ width: 200, flexShrink: 0, position: 'sticky', top: HEADER_AND_GAP }}>
          <CategoryList
            title={title}
            base={base}
            categories={categories}
            selected={open?.id ?? null}
            phone={false}
          />
        </Box>
        {/* minWidth: a wide table scrolls inside its own box instead of stretching the page. */}
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>{open?.content()}</Box>
      </Box>
    </Page>
  );
}
