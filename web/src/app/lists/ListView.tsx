import ArchiveRounded from '@mui/icons-material/ArchiveRounded';
import UnarchiveRounded from '@mui/icons-material/UnarchiveRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import {
  Alert,
  Button,
  IconButton,
  MenuItem,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { getEntity, isLive } from '../../core/collections.ts';
import { deleteList, inboxList, updateList } from '../../core/lists.ts';
import { filterClosedTasks } from '../../core/filters.ts';
import { listTasks } from '../../core/queries.ts';
import {
  groupByPriority,
  groupByTag,
  inOrder,
  LIST_GROUPINGS,
  orderTasks,
  sortTasks,
} from '../../core/listView.ts';
import type { List } from '../../core/types.ts';
import { t } from '../i18n/i18n.ts';
import { Page } from '../layout/Page.tsx';
import { useApply, useStoreState, useWorkspace } from '../store/hooks.ts';
import { AddTaskInput } from '../tasks/AddTaskInput.tsx';
import { TaskDragProvider } from '../tasks/drag/TaskDrag.tsx';
import { TaskTree } from '../tasks/TaskTree.tsx';
import { EmptyState } from '../views/EmptyState.tsx';
import { GroupSection } from '../views/GroupSection.tsx';
import { CompletedGroup, DateGroupedTasks, PinnedGroup } from '../views/groups.tsx';
import { groupZone } from '../views/dragZones.ts';
import { pinnedFirst } from '../../core/tasks.ts';
import { useToday } from '../hooks/useToday.ts';
import { useListView, type ListViewSettings } from './listGrouping.ts';
import { SortGroupButton, type ListLayout } from '../views/SortGroupButton.tsx';
import { useListLayout } from './listLayout.ts';
import { TimelineView } from './TimelineView.tsx';
import { ConfirmDialog, ListDialog } from './ListDialog.tsx';
import { ShareDialog } from './ShareDialog.tsx';
import { listMembersOf, myRole, type Role } from '../../core/sharing.ts';
import { ShareIcon } from '../icons/icons.tsx';
import { useSyncState } from '../sync/syncContext.ts';
import { listName } from './listName.ts';

function ListMenu({
  list,
  role,
  view,
  layout,
}: {
  list: List;
  /** My role on the list: only its owner changes it. */
  role: Role | null;
  view: ListViewSettings;
  layout: { value: ListLayout; onChange: (next: ListLayout) => void };
}) {
  const apply = useApply();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<'edit' | 'delete' | 'share' | null>(null);
  const workspace = useWorkspace();
  const phase = useSyncState((state) => state.phase);
  const authMode = useSyncState((state) => state.account?.authMode);
  // Sharing needs a server with accounts; the Mess Drawer is never shared.
  const canShare = phase === 'ready' && authMode === 'local' && !list.isInbox;
  const shared = listMembersOf(workspace, list.id).length;
  const owner = role === 'owner';
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  // Phones have room for the list's name or a row of buttons: Share joins the menu there.
  const menu = owner && !list.isInbox;
  const shareInMenu = canShare && phone && menu;
  return (
    <>
      {canShare && !shareInMenu && (
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
      <SortGroupButton
        view={view}
        groupings={LIST_GROUPINGS}
        layout={layout}
        // The list's own items join the one menu (the Mess Drawer has a fixed name: none).
        extra={(close) =>
          [
            shareInMenu && (
              <MenuItem
                key="share"
                onClick={() => {
                  close();
                  setDialog('share');
                }}
              >
                <ShareIcon fontSize="small" sx={{ mr: 1 }} />
                {t('share.button')}
              </MenuItem>
            ),
            menu && (
              <MenuItem
                key="edit"
                onClick={() => {
                  close();
                  setDialog('edit');
                }}
              >
                <EditRounded fontSize="small" sx={{ mr: 1 }} />
                {t('list.edit')}
              </MenuItem>
            ),
            menu && (
              <MenuItem
                key="archive"
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
            ),
            menu && (
              <MenuItem
                key="delete"
                onClick={() => {
                  close();
                  setDialog('delete');
                }}
              >
                <DeleteOutlineRounded fontSize="small" sx={{ mr: 1 }} />
                {t('list.delete')}
              </MenuItem>
            ),
          ].filter(Boolean)
        }
      />
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
      {dialog === 'delete' && (
        <ConfirmDialog
          open
          message={t('list.deleteConfirm', { name: listName(list, workspace) })}
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

export function ListContents({ list }: { list: List }) {
  const workspace = useWorkspace();
  const apply = useApply();
  const today = useToday();
  const me = useStoreState((state) => state.context().userId);
  const role = myRole(workspace, me, list.id);
  const canEdit = role === 'owner' || role === 'editor';
  const split = pinnedFirst(listTasks(workspace, list.id));
  const tasks = split.rest;
  // Pinned subtasks join the Pinned group too (they also stay under their parent).
  const pinned = [
    ...split.pinned,
    ...pinnedFirst(
      workspace.entities.tasks.filter(
        (task) => isLive(task) && task.listId === list.id && task.parentId !== null,
      ),
    ).pinned,
  ];
  const view = useListView(list.id);
  const { grouping, sort } = view;
  const filter = { lists: [list.id] };
  const completed = filterClosedTasks(workspace, filter, today);

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
      inList
      defaults={{ listId: list.id }}
      label={t('task.addTo', { list: listName(list, workspace) })}
    />
  ) : (
    <Typography variant="body2" color="text.secondary" sx={{ px: 1, pb: 1 }}>
      {t('share.viewerNote')}
    </Typography>
  );
  const [layoutValue, setLayout] = useListLayout(list.id);
  const actions = (
    <ListMenu
      list={list}
      role={role}
      view={view}
      layout={{ value: layoutValue, onChange: setLayout }}
    />
  );

  if (layoutValue === 'timeline') {
    const open = workspace.entities.tasks.filter(
      (task) => isLive(task) && task.status === 'open' && task.listId === list.id,
    );
    return (
      <Page title={listName(list, workspace)} actions={actions}>
        {archivedBar}
        {header}
        <TimelineView tasks={open} canEdit={canEdit} />
      </Page>
    );
  }

  if (grouping === 'date') {
    return (
      <Page title={listName(list, workspace)} actions={actions}>
        {archivedBar}
        {header}
        <DateGroupedTasks
          filter={filter}
          emptyTitle={t('list.empty')}
          sort={sort}
          reversed={view.sortReversed}
          groupsReversed={view.groupReversed}
        />
      </Page>
    );
  }

  if (grouping === 'priority' || grouping === 'tag') {
    // Groups the list's own order does not make: no dragging here.
    const open = sortTasks(tasks, sort, view.sortReversed);
    const byKind =
      grouping === 'priority'
        ? groupByPriority(open).map((group) => ({
            ...group,
            title: group.priority ? t(`priority.${group.priority}`) : t('list.noPriority'),
          }))
        : groupByTag(workspace, open).map((group) => ({
            ...group,
            title: group.name ?? t('list.noTags'),
          }));
    const grouped = inOrder(byKind, view.groupReversed);
    return (
      <Page title={listName(list, workspace)} actions={actions}>
        {archivedBar}
        {header}
        {open.length === 0 && pinned.length === 0 && completed.length === 0 && (
          <EmptyState title={t('list.empty')} />
        )}
        <TaskDragProvider>
          <PinnedGroup tasks={pinned} />
          {grouped.map((group) => (
            <GroupSection
              key={group.key}
              groupKey={group.key}
              title={group.title}
              count={group.tasks.length}
            >
              <TaskTree
                tasks={group.tasks}
                {...(canEdit ? { dragZone: groupZone(group.key) } : {})}
              />
            </GroupSection>
          ))}
        </TaskDragProvider>
        <CompletedGroup tasks={completed} />
      </Page>
    );
  }

  // The list's own order: tasks are dragged in it. Sorted another way, a drop switches to it.
  const draggable = canEdit;
  const shown = orderTasks(tasks, sort, view.sortReversed);
  const content = (
    <>
      {tasks.length === 0 && pinned.length === 0 && completed.length === 0 && (
        <EmptyState title={t('list.empty')} />
      )}
      <PinnedGroup tasks={pinned} />
      {shown.length > 0 && (
        <TaskTree tasks={shown} {...(draggable ? { dragZone: { listId: list.id } } : {})} />
      )}
    </>
  );

  return (
    <Page title={listName(list, workspace)} actions={actions}>
      {archivedBar}
      {header}
      {draggable ? (
        <TaskDragProvider
          {...(sort === 'manual' ? {} : { onReorder: () => view.setSort('manual') })}
        >
          {content}
        </TaskDragProvider>
      ) : (
        content
      )}
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
