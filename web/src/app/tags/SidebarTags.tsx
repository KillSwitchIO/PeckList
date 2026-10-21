import AddRounded from '@mui/icons-material/AddRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import TagRounded from '@mui/icons-material/TagRounded';
import {
  Box,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Tooltip,
  useTheme,
} from '@mui/material';
import { useState } from 'react';
import { useLocation } from 'react-router';
import { openTagCounts } from '../../core/queries.ts';
import { createTag, leafName, tagTree, type TagNode } from '../../core/tags.ts';
import type { Id } from '../../core/types.ts';
import { t } from '../i18n/i18n.ts';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { tagIconColor } from './tagColors.ts';
import { TagDialog } from './TagDialog.tsx';

const COLLAPSED_KEY = 'punchlist.collapsedTags';

// Which parent tags are collapsed is a per-browser convenience; it is fine to lose it.
function loadCollapsed(): Set<Id> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as Id[]) : []);
  } catch {
    return new Set();
  }
}

function saveCollapsed(ids: Set<Id>) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...ids]));
  } catch {
    // storage unavailable (private window); keep the in-memory state only
  }
}

/** Hide nodes under a collapsed parent. */
function visibleNodes(nodes: TagNode[], collapsed: Set<Id>): TagNode[] {
  const hidden = new Set<Id>();
  return nodes.filter((node) => {
    if (node.parentId && (hidden.has(node.parentId) || collapsed.has(node.parentId))) {
      hidden.add(node.tag.id);
      return false;
    }
    return true;
  });
}

function TagLink({
  node,
  count,
  collapsed,
  onToggle,
  onNavigate,
}: {
  node: TagNode;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  onNavigate: (path: string) => void;
}) {
  const theme = useTheme();
  const { pathname } = useLocation();
  const path = `/tags/${node.tag.id}`;
  const name = leafName(node.tag.name);
  // The expand toggle sits beside the link (not inside it): no button nested in a button.
  const toggle = node.hasChildren ? (
    <IconButton
      size="small"
      edge="end"
      aria-expanded={!collapsed}
      aria-label={collapsed ? t('tag.expand', { name }) : t('tag.collapse', { name })}
      onClick={onToggle}
    >
      <ChevronRightRounded
        fontSize="small"
        sx={{ transform: collapsed ? 'none' : 'rotate(90deg)', transition: 'transform 120ms' }}
      />
    </IconButton>
  ) : undefined;
  return (
    <ListItem disablePadding secondaryAction={toggle}>
      <ListItemButton
        selected={pathname === path}
        onClick={() => onNavigate(path)}
        sx={{ pl: 2 + node.depth * 2, pr: node.hasChildren ? 6 : 2 }}
      >
        <ListItemIcon sx={{ minWidth: 28 }}>
          <TagRounded
            sx={{
              fontSize: 16,
              color: tagIconColor(node.tag.color, theme.palette.background.default),
            }}
          />
        </ListItemIcon>
        <ListItemText primary={name} />
        {count > 0 && (
          <Box component="span" sx={{ typography: 'caption', color: 'text.secondary' }}>
            {count}
          </Box>
        )}
      </ListItemButton>
    </ListItem>
  );
}

/** Tags in the sidebar as a tree, with a create button. */
export function SidebarTags({ onNavigate }: { onNavigate: (path: string) => void }) {
  const workspace = useWorkspace();
  const apply = useApply();
  const [creating, setCreating] = useState(false);
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const counts = openTagCounts(workspace);
  const nodes = visibleNodes(tagTree(workspace), collapsed);

  const toggle = (id: Id) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      saveCollapsed(next);
      return next;
    });

  return (
    <>
      <List
        dense
        aria-label={t('nav.tags')}
        subheader={
          <ListSubheader
            sx={{ bgcolor: 'transparent', display: 'flex', alignItems: 'center', pr: 1 }}
          >
            <Box sx={{ flexGrow: 1 }}>{t('nav.tags')}</Box>
            <Tooltip title={t('tag.new')} disableFocusListener>
              <IconButton size="small" aria-label={t('tag.new')} onClick={() => setCreating(true)}>
                <AddRounded fontSize="small" />
              </IconButton>
            </Tooltip>
          </ListSubheader>
        }
      >
        {nodes.map((node) => (
          <TagLink
            key={node.tag.id}
            node={node}
            count={counts.get(node.tag.id) ?? 0}
            collapsed={collapsed.has(node.tag.id)}
            onToggle={() => toggle(node.tag.id)}
            onNavigate={onNavigate}
          />
        ))}
      </List>
      {creating && (
        <TagDialog
          onClose={() => setCreating(false)}
          onSubmit={(value) => {
            let id = '';
            apply((ctx, ws) => {
              const result = createTag(ctx, ws, value.name, value.color);
              id = result.tag.id;
              return result.workspace;
            });
            setCreating(false);
            onNavigate(`/tags/${id}`);
          }}
        />
      )}
    </>
  );
}
