import AddRounded from '@mui/icons-material/AddRounded';
import ArchiveOutlined from '@mui/icons-material/ArchiveOutlined';
import UnarchiveOutlined from '@mui/icons-material/UnarchiveOutlined';
import { Box, Button, ButtonBase, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { useRef, useState, type ReactNode } from 'react';
import {
  createList,
  deleteList,
  reorderLists,
  updateList,
  visibleLists,
} from '../../core/lists.ts';
import { describePrincipal, listMembersOf, listOwner, myRole } from '../../core/sharing.ts';
import { moveInOrder, pinnedListId, pinnedTagId, togglePinned } from '../../core/sidebar.ts';
import { createTag, deleteTag, leafName, tagTree, updateTag } from '../../core/tags.ts';
import type { List, Tag } from '../../core/types.ts';
import { AvatarStack } from '../friends/AvatarStack.tsx';
import { t } from '../i18n/i18n.ts';
import { DeleteIcon, ShareIcon } from '../icons/icons.tsx';
import { Page } from '../layout/Page.tsx';
import { PinButton } from '../layout/PinButton.tsx';
import { SidebarEditProvider } from '../layout/sidebarEdit.tsx';
import { useSidebarEdit } from '../layout/sidebarEditContext.ts';
import { SortHandle } from '../layout/SortHandle.tsx';
import { useSortableRows } from '../layout/useSortableRows.ts';
import { ConfirmDialog, ListDialog } from '../lists/ListDialog.tsx';
import { ListMark } from '../lists/ListMark.tsx';
import { listName } from '../lists/listName.ts';
import { ShareDialog } from '../lists/ShareDialog.tsx';
import { useApply, useStoreState, useWorkspace } from '../store/hooks.ts';
import { useSyncState } from '../sync/syncContext.ts';
import { TagDialog } from '../tags/TagDialog.tsx';
import { Section } from './settingsLayout.tsx';

/** One row of the manager: what it is on the left, its buttons on the right. */
function Row({
  children,
  actions,
  rowProps,
  dragging = false,
  depth = 0,
}: {
  children: ReactNode;
  actions: ReactNode;
  rowProps?: object;
  dragging?: boolean;
  depth?: number;
}) {
  return (
    <Box
      component="li"
      {...rowProps}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        minHeight: 52,
        pl: rowProps ? 2.5 : 1 + depth * 2.5,
        pr: 0.5,
        borderBottom: 1,
        borderColor: 'divider',
        bgcolor: dragging ? 'action.selected' : 'transparent',
        boxShadow: dragging ? 4 : 0,
        position: 'relative',
        zIndex: dragging ? 1 : 0,
      }}
    >
      {children}
      <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>{actions}</Box>
    </Box>
  );
}

/** A name and a line under it, as one button that opens the editor. */
function NameButton({
  name,
  detail,
  onClick,
  label,
}: {
  name: string;
  detail: ReactNode;
  onClick?: () => void;
  label: string;
}) {
  return (
    <ButtonBase
      disabled={!onClick}
      onClick={onClick}
      aria-label={label}
      sx={{
        flexGrow: 1,
        minWidth: 0,
        display: 'block',
        textAlign: 'left',
        py: 0.75,
        px: 0.5,
        borderRadius: 1,
      }}
    >
      <Typography noWrap>{name}</Typography>
      <Typography noWrap variant="caption" color="text.secondary" component="div">
        {detail}
      </Typography>
    </ButtonBase>
  );
}

const ul = { listStyle: 'none', m: 0, p: 0 } as const;

type Dialog =
  | { kind: 'newList' }
  | { kind: 'editList'; list: List }
  | { kind: 'shareList'; list: List }
  | { kind: 'deleteList'; list: List }
  | { kind: 'newTag' }
  | { kind: 'editTag'; tag: Tag }
  | { kind: 'deleteTag'; tag: Tag };

/**
 * Lists and tags in one place (R-FB-134): drag lists into the order the menu shows them, and from
 * each row change its name, icon and color, who it is shared with (people and groups), whether
 * it is pinned in the menu, archive it or delete it. Tags the same, bar the sharing.
 */
export function ManageListsPage() {
  // Pins are the menu's layout, which its editing context keeps.
  return (
    <SidebarEditProvider>
      <ManageLists />
    </SidebarEditProvider>
  );
}

function ManageLists() {
  const workspace = useWorkspace();
  const apply = useApply();
  const me = useStoreState((state) => state.context().userId);
  const phase = useSyncState((state) => state.phase);
  const authMode = useSyncState((state) => state.account?.authMode);
  // Sharing needs a server with accounts.
  const canShare = phase === 'ready' && authMode === 'local';
  const sidebar = useSidebarEdit();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const close = () => setDialog(null);

  const active = visibleLists(workspace).filter((list) => !list.isInbox);
  const archived = visibleLists(workspace, true).filter((list) => list.archived && !list.isInbox);
  // While a list is dragged, the order as it would land; saved when it is let go.
  const [order, setOrder] = useState<string[] | null>(null);
  const latest = useRef<string[] | null>(null);
  const ids = order ?? active.map((list) => list.id);
  const sortable = useSortableRows({
    // Always sorting here: only a row's grip drags, the rest of the page scrolls.
    editing: true,
    start: () => {},
    onDrag: (id, y) => {
      const base = latest.current ?? active.map((list) => list.id);
      const others = base.filter((each) => each !== id);
      const next = moveInOrder(base, id, sortable.slot(others, y));
      if (next.join() === base.join()) return;
      latest.current = next;
      setOrder(next);
    },
    onDrop: () => {
      const next = latest.current;
      if (next && next.join() !== active.map((list) => list.id).join()) {
        apply((ctx, ws) => reorderLists(ctx, ws, next), t('undo.listsReordered'));
      }
      latest.current = null;
      setOrder(null);
    },
  });

  const pinned = (id: string) => sidebar.current.layout.order.includes(id);
  const pin = (id: string) => sidebar.saveLayout(togglePinned(sidebar.current.layout, id));

  /** Who a list is shared with, in a few words. */
  const sharing = (list: List) => {
    const role = myRole(workspace, me, list.id);
    if (role !== 'owner') {
      const owner = describePrincipal(workspace, `user:${listOwner(list)}`);
      return t('manage.sharedBy', { name: owner.name });
    }
    const members = listMembersOf(workspace, list.id);
    if (list.visibility !== 'shared' || members.length === 0) return t('manage.onlyYou');
    return t('manage.sharedWith', {
      names: members
        .map((member) => describePrincipal(workspace, member.principal).name)
        .join(', '),
    });
  };

  const listRow = (list: List, sortableRow: boolean) => {
    const owner = myRole(workspace, me, list.id) === 'owner';
    const name = listName(list, workspace);
    const members = listMembersOf(workspace, list.id).map((member) =>
      describePrincipal(workspace, member.principal),
    );
    return (
      <Row
        key={list.id}
        {...(sortableRow
          ? { rowProps: sortable.rowProps(list.id), dragging: sortable.dragging === list.id }
          : {})}
        actions={
          <>
            {canShare && owner && (
              <Tooltip title={t('share.button')}>
                <IconButton
                  aria-label={t('manage.shareList', { name })}
                  onClick={() => setDialog({ kind: 'shareList', list })}
                  sx={{ color: members.length > 0 ? 'primary.main' : undefined }}
                >
                  {members.length > 0 ? (
                    <AvatarStack people={members} size={22} max={2} />
                  ) : (
                    <ShareIcon fontSize="small" />
                  )}
                </IconButton>
              </Tooltip>
            )}
            {!list.archived && (
              <PinButton
                pinned={pinned(pinnedListId(list.id))}
                name={name}
                onToggle={() => pin(pinnedListId(list.id))}
              />
            )}
            {owner && (
              <Tooltip title={list.archived ? t('list.unarchive') : t('list.archive')}>
                <IconButton
                  aria-label={
                    list.archived
                      ? t('manage.unarchiveList', { name })
                      : t('manage.archiveList', { name })
                  }
                  onClick={() =>
                    apply(
                      (ctx, ws) => updateList(ctx, ws, list.id, { archived: !list.archived }),
                      list.archived ? t('undo.listUnarchived') : t('undo.listArchived'),
                    )
                  }
                >
                  {list.archived ? (
                    <UnarchiveOutlined fontSize="small" />
                  ) : (
                    <ArchiveOutlined fontSize="small" />
                  )}
                </IconButton>
              </Tooltip>
            )}
            {owner && (
              <Tooltip title={t('list.delete')}>
                <IconButton
                  aria-label={t('manage.deleteList', { name })}
                  onClick={() => setDialog({ kind: 'deleteList', list })}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </>
        }
      >
        {sortableRow && <SortHandle />}
        <IconButton
          disabled={!owner}
          aria-label={t('manage.editList', { name })}
          onClick={() => setDialog({ kind: 'editList', list })}
        >
          <ListMark list={list} faded={list.archived} />
        </IconButton>
        <NameButton
          name={name}
          detail={sharing(list)}
          label={t('manage.editList', { name })}
          {...(owner ? { onClick: () => setDialog({ kind: 'editList', list }) } : {})}
        />
      </Row>
    );
  };

  const byId = new Map(active.map((list) => [list.id, list]));
  const tags = tagTree(workspace);

  return (
    <Page title={t('manage.title')}>
      <Stack spacing={4}>
        <Section
          title={t('nav.lists')}
          hint={t('manage.listsHint')}
          action={
            <Button
              size="small"
              startIcon={<AddRounded />}
              onClick={() => setDialog({ kind: 'newList' })}
            >
              {t('list.new')}
            </Button>
          }
        >
          <Box component="ul" aria-label={t('manage.lists')} sx={ul}>
            {ids.map((id) => byId.get(id)).map((list) => list && listRow(list, true))}
          </Box>
          {active.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 1 }}>
              {t('manage.noLists')}
            </Typography>
          )}
          {archived.length > 0 && (
            <>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 2.5, mb: 0.5 }}>
                {t('list.archived')}
              </Typography>
              <Box component="ul" aria-label={t('manage.archived')} sx={ul}>
                {archived.map((list) => listRow(list, false))}
              </Box>
            </>
          )}
        </Section>

        <Section
          title={t('nav.tags')}
          hint={t('manage.tagsHint')}
          action={
            <Button
              size="small"
              startIcon={<AddRounded />}
              onClick={() => setDialog({ kind: 'newTag' })}
            >
              {t('tag.new')}
            </Button>
          }
        >
          <Box component="ul" aria-label={t('manage.tags')} sx={ul}>
            {tags.map(({ tag, depth }) => {
              const name = leafName(tag.name);
              return (
                <Row
                  key={tag.id}
                  depth={depth}
                  actions={
                    <>
                      <PinButton
                        pinned={pinned(pinnedTagId(tag.id))}
                        name={name}
                        onToggle={() => pin(pinnedTagId(tag.id))}
                      />
                      <Tooltip title={t('tag.delete')}>
                        <IconButton
                          aria-label={t('manage.deleteTag', { name })}
                          onClick={() => setDialog({ kind: 'deleteTag', tag })}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </>
                  }
                >
                  <IconButton
                    aria-label={t('manage.editTag', { name })}
                    onClick={() => setDialog({ kind: 'editTag', tag })}
                  >
                    <Box sx={{ width: 14, height: 14, borderRadius: '50%', bgcolor: tag.color }} />
                  </IconButton>
                  <NameButton
                    name={name}
                    detail={tag.name.includes('/') ? tag.name : null}
                    label={t('manage.editTag', { name })}
                    onClick={() => setDialog({ kind: 'editTag', tag })}
                  />
                </Row>
              );
            })}
          </Box>
          {tags.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 1 }}>
              {t('manage.noTags')}
            </Typography>
          )}
        </Section>
      </Stack>

      {dialog?.kind === 'newList' && (
        <ListDialog
          open
          onClose={close}
          onSubmit={(value) => {
            apply((ctx, ws) => createList(ctx, ws, value).workspace);
            close();
          }}
        />
      )}
      {dialog?.kind === 'editList' && (
        <ListDialog
          open
          list={dialog.list}
          onClose={close}
          onSubmit={(value) => {
            apply((ctx, ws) => updateList(ctx, ws, dialog.list.id, value));
            close();
          }}
        />
      )}
      {dialog?.kind === 'shareList' && <ShareDialog list={dialog.list} onClose={close} />}
      {dialog?.kind === 'deleteList' && (
        <ConfirmDialog
          open
          message={t('list.deleteConfirm', { name: listName(dialog.list, workspace) })}
          confirmLabel={t('common.delete')}
          onClose={close}
          onConfirm={() => {
            close();
            apply((ctx, ws) => deleteList(ctx, ws, dialog.list.id), t('undo.listDeleted'));
          }}
        />
      )}
      {dialog?.kind === 'newTag' && (
        <TagDialog
          onClose={close}
          onSubmit={(value) => {
            apply((ctx, ws) => createTag(ctx, ws, value.name, value.color).workspace);
            close();
          }}
        />
      )}
      {dialog?.kind === 'editTag' && (
        <TagDialog
          tag={dialog.tag}
          onClose={close}
          onSubmit={(value) => {
            apply((ctx, ws) => updateTag(ctx, ws, dialog.tag.id, value));
            close();
          }}
        />
      )}
      {dialog?.kind === 'deleteTag' && (
        <ConfirmDialog
          open
          message={t('tag.deleteConfirm', { name: dialog.tag.name })}
          confirmLabel={t('common.delete')}
          onClose={close}
          onConfirm={() => {
            close();
            apply((ctx, ws) => deleteTag(ctx, ws, dialog.tag.id), t('undo.tagDeleted'));
          }}
        />
      )}
    </Page>
  );
}
