import AddRounded from '@mui/icons-material/AddRounded';
import ArchiveRounded from '@mui/icons-material/ArchiveRounded';
import UnarchiveRounded from '@mui/icons-material/UnarchiveRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import PlaylistAddRounded from '@mui/icons-material/PlaylistAddRounded';
import {
  Alert,
  Button,
  Divider,
  IconButton,
  ListSubheader,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { getEntity, isLive } from '../../core/collections.ts';
import {
  createSection,
  deleteList,
  deleteSection,
  inboxList,
  moveSection,
  renameSection,
  updateList,
} from '../../core/lists.ts';
import { filterClosedTasks } from '../../core/filters.ts';
import { listTasks } from '../../core/queries.ts';
import {
  groupByPriority,
  groupByTag,
  LIST_GROUPINGS,
  LIST_SORTS,
  sortTasks,
} from '../../core/listView.ts';
import type { List, Section } from '../../core/types.ts';
import { t } from '../i18n/i18n.ts';
import { Page } from '../layout/Page.tsx';
import { useApply, useStoreState, useWorkspace } from '../store/hooks.ts';
import { AddTaskInput } from '../tasks/AddTaskInput.tsx';
import { TaskDragProvider } from '../tasks/drag/TaskDrag.tsx';
import { TaskTree } from '../tasks/TaskTree.tsx';
import { EmptyState } from '../views/EmptyState.tsx';
import { GroupSection } from '../views/GroupSection.tsx';
import { useSectionDrag } from './sectionDrag.tsx';
import { CompletedGroup, DateGroupedTasks } from '../views/groups.tsx';
import { useToday } from '../hooks/useToday.ts';
import { useListView, type ListViewSettings } from './listGrouping.ts';
import { ConfirmDialog, ListDialog, NameDialog } from './ListDialog.tsx';
import { ShareDialog } from './ShareDialog.tsx';
import { listMembersOf, myRole, type Role } from '../../core/sharing.ts';
import { ShareIcon } from '../icons/icons.tsx';
import { useSyncState } from '../sync/syncContext.ts';
import { listName } from './listName.ts';

function ListMenu({
  list,
  role,
  view,
}: {
  list: List;
  /** My role on the list: only its owner changes it; editors add sections too. */
  role: Role | null;
  view: ListViewSettings;
}) {
  const apply = useApply();
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [dialog, setDialog] = useState<'edit' | 'section' | 'delete' | 'share' | null>(null);
  const close = () => setAnchor(null);
  const workspace = useWorkspace();
  const phase = useSyncState((state) => state.phase);
  const authMode = useSyncState((state) => state.account?.authMode);
  // Sharing needs a server with accounts; the Mess Drawer is never shared.
  const canShare = phase === 'ready' && authMode === 'local' && !list.isInbox;
  const shared = listMembersOf(workspace, list.id).length;
  const owner = role === 'owner';
  const editor = owner || role === 'editor';
  return (
    <>
      {canShare && (
        <Tooltip
          title={
            shared === 0
              ? t('share.button')
              : shared === 1
                ? t('share.sharedOne')
                : t('share.sharedMany', { count: shared })
          }
          disableFocusListener
        >
          <IconButton
            aria-label={t('share.button')}
            onClick={() => setDialog('share')}
            sx={{ color: shared > 0 ? 'primary.main' : undefined }}
          >
            <ShareIcon />
          </IconButton>
        </Tooltip>
      )}
      <Tooltip title={t('common.more')} disableFocusListener>
        <IconButton
          aria-label={t('common.more')}
          onClick={(event) => setAnchor(event.currentTarget)}
        >
          <MoreVertRounded />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={close}>
        <ListSubheader sx={{ lineHeight: '32px', bgcolor: 'transparent' }}>
          {t('list.groupBy')}
        </ListSubheader>
        {LIST_GROUPINGS.map((mode) => (
          <MenuItem
            key={`group-${mode}`}
            dense
            aria-label={t('list.groupByOption', { name: t(`list.group.${mode}`).toLowerCase() })}
            selected={view.grouping === mode}
            onClick={() => {
              close();
              view.setGrouping(mode);
            }}
          >
            {t(`list.group.${mode}`)}
            {view.grouping === mode && <CheckRounded fontSize="small" sx={{ ml: 'auto', pl: 1 }} />}
          </MenuItem>
        ))}
        <ListSubheader sx={{ lineHeight: '32px', bgcolor: 'transparent' }}>
          {t('list.sortBy')}
        </ListSubheader>
        {LIST_SORTS.map((mode) => (
          <MenuItem
            key={`sort-${mode}`}
            dense
            aria-label={t('list.sortByOption', { name: t(`list.sort.${mode}`).toLowerCase() })}
            selected={view.sort === mode}
            onClick={() => {
              close();
              view.setSort(mode);
            }}
          >
            {t(`list.sort.${mode}`)}
            {view.sort === mode && <CheckRounded fontSize="small" sx={{ ml: 'auto', pl: 1 }} />}
          </MenuItem>
        ))}
        {editor && <Divider />}
        {/* The Mess Drawer has a fixed name and no color: nothing to edit. */}
        {owner && !list.isInbox && (
          <MenuItem
            onClick={() => {
              close();
              setDialog('edit');
            }}
          >
            <EditRounded fontSize="small" sx={{ mr: 1 }} />
            {t('list.edit')}
          </MenuItem>
        )}
        {editor && (
          <MenuItem
            onClick={() => {
              close();
              setDialog('section');
            }}
          >
            <PlaylistAddRounded fontSize="small" sx={{ mr: 1 }} />
            {t('list.addSection')}
          </MenuItem>
        )}
        {owner && !list.isInbox && (
          <MenuItem
            onClick={() => {
              close();
              if (list.archived) {
                apply((ctx, ws) => updateList(ctx, ws, list.id, { archived: false }));
                return;
              }
              apply(
                (ctx, ws) => updateList(ctx, ws, list.id, { archived: true }),
                t('undo.listArchived'),
              );
              void navigate('/inbox');
            }}
          >
            {list.archived ? (
              <UnarchiveRounded fontSize="small" sx={{ mr: 1 }} />
            ) : (
              <ArchiveRounded fontSize="small" sx={{ mr: 1 }} />
            )}
            {list.archived ? t('list.unarchive') : t('list.archive')}
          </MenuItem>
        )}
        {owner && !list.isInbox && (
          <MenuItem
            onClick={() => {
              close();
              setDialog('delete');
            }}
          >
            <DeleteOutlineRounded fontSize="small" sx={{ mr: 1 }} />
            {t('list.delete')}
          </MenuItem>
        )}
      </Menu>
      {dialog === 'share' && <ShareDialog list={list} onClose={() => setDialog(null)} />}
      {dialog === 'edit' && (
        <ListDialog
          open
          list={list}
          onClose={() => setDialog(null)}
          onSubmit={(value) => {
            apply((ctx, ws) => updateList(ctx, ws, list.id, value));
            setDialog(null);
          }}
        />
      )}
      {dialog === 'section' && (
        <NameDialog
          open
          title={t('list.addSection')}
          label={t('list.sectionName')}
          submitLabel={t('common.create')}
          onClose={() => setDialog(null)}
          onSubmit={(name) => {
            apply((ctx, ws) => createSection(ctx, ws, list.id, name).workspace);
            setDialog(null);
            // A new section only shows when grouping by section.
            view.setGrouping('section');
          }}
        />
      )}
      {dialog === 'delete' && (
        <ConfirmDialog
          open
          message={t('list.deleteConfirm', { name: listName(list) })}
          confirmLabel={t('common.delete')}
          onClose={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null);
            apply((ctx, ws) => deleteList(ctx, ws, list.id), t('undo.listDeleted'));
            void navigate('/inbox');
          }}
        />
      )}
    </>
  );
}

function SectionActions({
  section,
  onAdd,
  onMove,
}: {
  section: Section;
  onAdd: () => void;
  /** Move one place up or down; absent at that end. */
  onMove: { up?: () => void; down?: () => void };
}) {
  const apply = useApply();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [renaming, setRenaming] = useState(false);
  return (
    <>
      <IconButton size="small" aria-label={`${t('task.add')}: ${section.name}`} onClick={onAdd}>
        <AddRounded fontSize="small" />
      </IconButton>
      <IconButton
        size="small"
        aria-label={`${t('common.more')}: ${section.name}`}
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        <MoreVertRounded fontSize="small" />
      </IconButton>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        <MenuItem
          onClick={() => {
            setAnchor(null);
            setRenaming(true);
          }}
        >
          {t('common.rename')}
        </MenuItem>
        {onMove.up && (
          <MenuItem
            onClick={() => {
              setAnchor(null);
              onMove.up?.();
            }}
          >
            {t('list.sectionUp')}
          </MenuItem>
        )}
        {onMove.down && (
          <MenuItem
            onClick={() => {
              setAnchor(null);
              onMove.down?.();
            }}
          >
            {t('list.sectionDown')}
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            setAnchor(null);
            apply((ctx, ws) => deleteSection(ctx, ws, section.id), t('undo.sectionDeleted'));
          }}
        >
          {t('list.deleteSection')}
        </MenuItem>
      </Menu>
      {renaming && (
        <NameDialog
          open
          title={t('common.rename')}
          label={t('list.sectionName')}
          initial={section.name}
          submitLabel={t('common.save')}
          onClose={() => setRenaming(false)}
          onSubmit={(name) => {
            apply((ctx, ws) => renameSection(ctx, ws, section.id, name));
            setRenaming(false);
          }}
        />
      )}
    </>
  );
}

export function ListContents({ list }: { list: List }) {
  const workspace = useWorkspace();
  const apply = useApply();
  const today = useToday();
  const me = useStoreState((state) => state.context().userId);
  const role = myRole(workspace, me, list.id);
  const canEdit = role === 'owner' || role === 'editor';
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const groups = listTasks(workspace, list.id);
  const view = useListView(list.id, groups.length > 1);
  const { grouping, sort } = view;
  const moveTo = (id: string, beforeId: string | null) =>
    apply((ctx, ws) => moveSection(ctx, ws, id, beforeId), t('undo.sectionMoved'));
  const sectionDrag = useSectionDrag(moveTo);
  const sectionIds = groups.flatMap((group) => (group.sectionId ? [group.sectionId] : []));
  const filter = { lists: [list.id] };
  const completed = filterClosedTasks(workspace, filter, today);
  const empty = groups.every((group) => group.tasks.length === 0);

  const archivedBar = list.archived && (
    <Alert
      severity="info"
      variant="outlined"
      icon={<ArchiveRounded fontSize="small" />}
      sx={{ mb: 1.5, alignItems: 'center' }}
      {...(role === 'owner'
        ? {
            action: (
              <Button
                size="small"
                onClick={() =>
                  apply((ctx, ws) => updateList(ctx, ws, list.id, { archived: false }))
                }
              >
                {t('list.unarchive')}
              </Button>
            ),
          }
        : {})}
    >
      {t('list.archivedNote')}
    </Alert>
  );
  const header = canEdit ? (
    <AddTaskInput
      defaults={{ listId: list.id }}
      label={t('task.addTo', { list: listName(list) })}
    />
  ) : (
    <Typography variant="body2" color="text.secondary" sx={{ px: 1, pb: 1 }}>
      {t('share.viewerNote')}
    </Typography>
  );
  const actions = <ListMenu list={list} role={role} view={view} />;

  if (grouping === 'date') {
    return (
      <Page title={listName(list)} actions={actions}>
        {archivedBar}
        {header}
        <DateGroupedTasks filter={filter} emptyTitle={t('list.empty')} sort={sort} />
      </Page>
    );
  }

  if (grouping !== 'section') {
    // Groups the list's own order does not make: no dragging here.
    const open = sortTasks(
      groups.flatMap((group) => group.tasks),
      sort,
    );
    const grouped =
      grouping === 'priority'
        ? groupByPriority(open).map((group) => ({
            ...group,
            title: group.priority ? t(`priority.${group.priority}`) : t('list.noPriority'),
          }))
        : grouping === 'tag'
          ? groupByTag(workspace, open).map((group) => ({
              ...group,
              title: group.name ?? t('list.noTags'),
            }))
          : null;
    return (
      <Page title={listName(list)} actions={actions}>
        {archivedBar}
        {header}
        {open.length === 0 && completed.length === 0 && <EmptyState title={t('list.empty')} />}
        {grouped
          ? grouped.map((group) => (
              <GroupSection key={group.key} title={group.title} count={group.tasks.length}>
                <TaskTree tasks={group.tasks} />
              </GroupSection>
            ))
          : open.length > 0 && <TaskTree tasks={open} />}
        <CompletedGroup tasks={completed} />
      </Page>
    );
  }

  // Dragging follows the list's own order: only when sorted by it.
  const draggable = canEdit && sort === 'manual';
  const shown =
    sort === 'manual'
      ? groups
      : groups.map((group) => ({ ...group, tasks: sortTasks(group.tasks, sort) }));

  const zone = (sectionId: string | null) =>
    draggable ? { dragZone: { listId: list.id, sectionId } } : {};
  const content = (
    <>
      {empty && groups.length === 1 && completed.length === 0 && (
        <EmptyState title={t('list.empty')} />
      )}
      {shown.map((group) => {
        const section = group.sectionId ? getEntity(workspace, 'sections', group.sectionId) : null;
        if (!section) return <TaskTree key="none" tasks={group.tasks} {...zone(null)} />;
        return (
          <GroupSection
            key={section.id}
            title={section.name}
            count={group.tasks.length}
            {...(canEdit
              ? {
                  headerProps: sectionDrag.headerProps(section.id),
                  actions: (
                    <SectionActions
                      section={section}
                      onAdd={() => setAddingTo(section.id)}
                      onMove={(() => {
                        const at = sectionIds.indexOf(section.id);
                        return {
                          ...(at > 0 ? { up: () => moveTo(section.id, sectionIds[at - 1]!) } : {}),
                          ...(at < sectionIds.length - 1
                            ? { down: () => moveTo(section.id, sectionIds[at + 2] ?? null) }
                            : {}),
                        };
                      })()}
                    />
                  ),
                }
              : {})}
          >
            {addingTo === section.id && (
              <AddTaskInput defaults={{ listId: list.id, sectionId: section.id }} autoFocus />
            )}
            <TaskTree tasks={group.tasks} {...zone(section.id)} />
          </GroupSection>
        );
      })}
      {sectionDrag.overlay}
    </>
  );

  return (
    <Page title={listName(list)} actions={actions}>
      {archivedBar}
      {header}
      {draggable ? <TaskDragProvider>{content}</TaskDragProvider> : content}
      <CompletedGroup tasks={completed} />
    </Page>
  );
}

export function ListView() {
  const workspace = useWorkspace();
  const { listId } = useParams();
  const list = listId ? getEntity(workspace, 'lists', listId) : undefined;
  if (!list || !isLive(list)) {
    return (
      <Page title={t('nav.lists')}>
        <EmptyState title={t('list.notFound')} />
      </Page>
    );
  }
  return <ListContents key={list.id} list={list} />;
}

export function InboxView() {
  const workspace = useWorkspace();
  const inbox = inboxList(workspace);
  return <ListContents key={inbox.id} list={inbox} />;
}
