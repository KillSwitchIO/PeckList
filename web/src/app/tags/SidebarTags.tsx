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
  Tooltip,
  useTheme,
} from '@mui/material';
import { useState } from 'react';
import { useLocation } from 'react-router';
import { openTagCounts } from '../../core/queries.ts';
import { moveInOrder, pinnedTagId, togglePinned } from '../../core/sidebar.ts';
import { createTag, leafName, tagTree, type TagNode } from '../../core/tags.ts';
import { useCollapsedSet, withoutCollapsed } from '../hooks/useCollapsedSet.ts';
import { t } from '../i18n/i18n.ts';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { DragHandleIcon } from '../icons/icons.tsx';
import { editingRowSx, useSidebarEdit } from '../layout/sidebarEditContext.ts';
import { SectionHeader } from '../layout/SectionHeader.tsx';
import { useSortableRows } from '../layout/useSortableRows.ts';
import { PinButton } from '../layout/PinButton.tsx';
import { tagIconColor } from './tagColors.ts';
import { TagDialog } from './TagDialog.tsx';

function TagLink({
  node,
  index,
  count,
  collapsed,
  onToggle,
  onNavigate,
  sortable,
}: {
  node: TagNode;
  index: number;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  onNavigate: (path: string) => void;
  sortable: ReturnType<typeof useSortableRows>;
}) {
  const edit = useSidebarEdit();
  const { editing } = edit;
  const pin = pinnedTagId(node.tag.id);
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
  const pinButton = editing ? (
    <PinButton
      pinned={edit.current.layout.order.includes(pin)}
      name={node.tag.name}
      onToggle={() =>
        edit.update((draft) => ({ ...draft, layout: togglePinned(draft.layout, pin) }))
      }
    />
  ) : null;
  return (
    <ListItem
      disablePadding
      secondaryAction={
        pinButton || toggle ? (
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            {pinButton}
            {toggle}
          </Box>
        ) : undefined
      }
    >
      <ListItemButton
        {...sortable.rowProps(node.tag.id)}
        selected={!editing && pathname === path}
        onClick={sortable.click(() => {
          if (!editing) onNavigate(path);
        })}
        sx={{
          pl: 2 + node.depth * 2,
          pr: (node.hasChildren ? 6 : 2) + (editing ? 4 : 0),
          ...editingRowSx(editing, sortable.dragging === node.tag.id, index),
        }}
      >
        {editing && (
          <DragHandleIcon
            fontSize="small"
            sx={{ color: 'text.disabled', ml: -1, mr: 0.5, cursor: 'grab' }}
          />
        )}
        <ListItemIcon sx={{ minWidth: 28 }}>
          <TagRounded
            sx={{
              fontSize: 16,
              color: tagIconColor(node.tag.color, theme.palette.background.default),
            }}
          />
        </ListItemIcon>
        <ListItemText primary={name} />
        {!editing && count > 0 && (
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
  // Folded sections are remembered on this device.
  const { collapsed: folded, toggle: fold } = useCollapsedSet('punchlist.foldedSections');
  const { collapsed, toggle } = useCollapsedSet('punchlist.collapsedTags');
  const counts = openTagCounts(workspace);
  const edit = useSidebarEdit();
  // The tree in the order being edited (siblings sort by their place in the draft).
  const position = new Map(edit.current.tags.map((id, index) => [id, index]));
  const tree = tagTree({
    ...workspace,
    entities: {
      ...workspace.entities,
      tags: workspace.entities.tags.map((tag) => ({
        ...tag,
        order: String(position.get(tag.id) ?? 99999).padStart(6, '0'),
      })),
    },
  });
  const nodes = withoutCollapsed(
    tree,
    (node) => node.tag.id,
    (node) => node.parentId,
    collapsed,
  );
  const sortable = useSortableRows({
    editing: edit.editing,
    start: edit.start,
    // A tag moves among its siblings; its subtags come along.
    onDrag: (id, y) =>
      edit.update((draft) => {
        const parent = tree.find((node) => node.tag.id === id)?.parentId ?? null;
        const siblings = tree.filter((node) => node.parentId === parent).map((node) => node.tag.id);
        const index = sortable.slot(
          siblings.filter((each) => each !== id),
          y,
        );
        const moved = moveInOrder(siblings, id, index);
        if (moved.join() === siblings.join()) return draft;
        return {
          ...draft,
          tags: [...draft.tags.filter((each) => !siblings.includes(each)), ...moved],
        };
      }),
  });

  return (
    <>
      <List
        dense
        aria-label={t('nav.tags')}
        subheader={
          <SectionHeader
            title={t('nav.tags')}
            open={!folded.has('tags')}
            onToggle={() => fold('tags')}
            actions={
              <Tooltip title={t('tag.new')} disableFocusListener>
                <IconButton
                  size="small"
                  aria-label={t('tag.new')}
                  onClick={() => setCreating(true)}
                >
                  <AddRounded fontSize="small" />
                </IconButton>
              </Tooltip>
            }
          />
        }
      >
        {!folded.has('tags') &&
          nodes.map((node, index) => (
            <TagLink
              key={node.tag.id}
              node={node}
              index={index}
              sortable={sortable}
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
