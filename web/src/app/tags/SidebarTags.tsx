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
import { pinnedTagId, togglePinned } from '../../core/sidebar.ts';
import {
  createTag,
  isUnder,
  leafName,
  moveTagNames,
  tagTree,
  type TagNode,
} from '../../core/tags.ts';
import { useCollapsedSet, withoutCollapsed } from '../hooks/useCollapsedSet.ts';
import { t } from '../i18n/i18n.ts';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { DragHandleIcon } from '../icons/icons.tsx';
import { editingRowSx, useSidebarEdit, type SidebarDraft } from '../layout/sidebarEditContext.ts';
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
  nestTarget,
}: {
  node: TagNode;
  index: number;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  onNavigate: (path: string) => void;
  sortable: ReturnType<typeof useSortableRows>;
  /** Dropping now would nest the dragged tag under this one. */
  nestTarget: boolean;
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
          ...(nestTarget && {
            bgcolor: 'action.selected',
            outline: `2px solid ${theme.palette.primary.main}`,
            outlineOffset: -2,
          }),
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
  // The tree as being edited: siblings sort by their place in the draft, moved tags show
  // under their new parent.
  const treeOf = (draft: SidebarDraft) => {
    const position = new Map(draft.tags.map((id, index) => [id, index]));
    return tagTree({
      ...workspace,
      entities: {
        ...workspace.entities,
        tags: workspace.entities.tags.map((tag) => ({
          ...tag,
          name: draft.tagNames[tag.id] ?? tag.name,
          order: String(position.get(tag.id) ?? 99999).padStart(6, '0'),
        })),
      },
    });
  };
  const tree = treeOf(edit.current);
  const [nestTarget, setNestTarget] = useState<string | null>(null);

  /** The draft with `id` moved under `parent` (null: top level), or null if it can't go there. */
  const reparent = (draft: SidebarDraft, id: string, parent: string | null) => {
    const names = moveTagNames(
      treeOf(draft).map((node) => node.tag),
      id,
      parent,
    );
    return names
      ? { ...draft, tagNames: { ...draft.tagNames, ...Object.fromEntries(names) } }
      : null;
  };
  /** The draft with `id` placed at `index` among `parent`'s children. */
  const place = (draft: SidebarDraft, id: string, parent: string | null, index: number) => {
    const siblings = treeOf(draft)
      .filter((node) => node.parentId === parent && node.tag.id !== id)
      .map((node) => node.tag.id);
    const order = [...siblings.slice(0, index), id, ...siblings.slice(index)];
    return { ...draft, tags: [...draft.tags.filter((each) => !order.includes(each)), ...order] };
  };
  const nodes = withoutCollapsed(
    tree,
    (node) => node.tag.id,
    (node) => node.parentId,
    collapsed,
  );
  const sortable = useSortableRows({
    editing: edit.editing,
    start: edit.start,
    // Over the middle of another tag: dropping nests under it. Near a row's top or bottom
    // edge: the tag goes before or after that row, at its level (so under its parent). A tag's
    // subtags always come along.
    onDrag: (id, y) => {
      const draft = edit.current;
      const dragged = tree.find((node) => node.tag.id === id);
      if (!dragged) return;
      const over = nodes.find((node) => {
        const box = sortable.box(node.tag.id);
        return node.tag.id !== id && box !== undefined && y >= box.top && y < box.bottom;
      });
      if (!over || isUnder(over.tag.name, dragged.tag.name)) {
        setNestTarget(null);
        return;
      }
      const box = sortable.box(over.tag.id)!;
      const zone = (y - box.top) / box.height;
      if (zone > 0.3 && zone < 0.7) {
        setNestTarget(over.tag.id);
        return;
      }
      setNestTarget(null);
      const moved = over.parentId === dragged.parentId ? draft : reparent(draft, id, over.parentId);
      if (!moved) return;
      const siblings = treeOf(moved)
        .filter((node) => node.parentId === over.parentId && node.tag.id !== id)
        .map((node) => node.tag.id);
      const index = siblings.indexOf(over.tag.id) + (zone >= 0.5 ? 1 : 0);
      const next = place(moved, id, over.parentId, index);
      if (next.tags.join() !== draft.tags.join() || moved !== draft) edit.update(() => next);
    },
    onDrop: (id) => {
      if (nestTarget) {
        const moved = reparent(edit.current, id, nestTarget);
        if (moved) {
          const children = treeOf(moved).filter((node) => node.parentId === nestTarget).length;
          edit.update(() => place(moved, id, nestTarget, children));
        }
      }
      setNestTarget(null);
    },
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
              nestTarget={nestTarget === node.tag.id}
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
