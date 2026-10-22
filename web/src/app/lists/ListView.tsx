import AddRounded from '@mui/icons-material/AddRounded';
import ArchiveRounded from '@mui/icons-material/ArchiveRounded';
import UnarchiveRounded from '@mui/icons-material/UnarchiveRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import EventRounded from '@mui/icons-material/EventRounded';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import PlaylistAddRounded from '@mui/icons-material/PlaylistAddRounded';
import ViewAgendaOutlined from '@mui/icons-material/ViewAgendaOutlined';
import {
  Alert,
  Button,
  Divider,
  IconButton,
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
  renameSection,
  updateList,
} from '../../core/lists.ts';
import { filterClosedTasks } from '../../core/filters.ts';
import { listTasks } from '../../core/queries.ts';
import type { List, Section } from '../../core/types.ts';
import { t } from '../i18n/i18n.ts';
import { Page } from '../layout/Page.tsx';
import { useApply, useStoreState, useWorkspace } from '../store/hooks.ts';
import { AddTaskInput } from '../tasks/AddTaskInput.tsx';
import { TaskDragProvider } from '../tasks/drag/TaskDrag.tsx';
import { TaskTree } from '../tasks/TaskTree.tsx';
import { EmptyState } from '../views/EmptyState.tsx';
import { GroupSection } from '../views/GroupSection.tsx';
import { CompletedGroup, DateGroupedTasks } from '../views/groups.tsx';
import { useToday } from '../hooks/useToday.ts';
import { useListGrouping, type ListGrouping } from './listGrouping.ts';
import { ConfirmDialog, ListDialog, NameDialog } from './ListDialog.tsx';
import { ShareDialog } from './ShareDialog.tsx';
import { listMembersOf, myRole, type Role } from '../../core/sharing.ts';
import { ShareIcon } from '../icons/icons.tsx';
import { useSyncState } from '../sync/syncContext.ts';
import { listName } from './listName.ts';

function ListMenu({
  list,
  role,
  grouping,
  onGrouping,
}: {
  list: List;
  /** My role on the list: only its owner changes it; editors add sections too. */
  role: Role | null;
  grouping: ListGrouping;
  onGrouping: (next: ListGrouping) => void;
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
        {(['date', 'section'] as const).map((mode) => (
          <MenuItem
            key={mode}
            selected={grouping === mode}
            onClick={() => {
              close();
              onGrouping(mode);
            }}
          >
            {mode === 'date' ? (
              <EventRounded fontSize="small" sx={{ mr: 1 }} />
            ) : (
              <ViewAgendaOutlined fontSize="small" sx={{ mr: 1 }} />
            )}
            {mode === 'date' ? t('list.groupByDate') : t('list.groupBySection')}
            {grouping === mode && <CheckRounded fontSize="small" sx={{ ml: 'auto', pl: 1 }} />}
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
            onGrouping('section');
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

function SectionActions({ section, onAdd }: { section: Section; onAdd: () => void }) {
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
  const [grouping, setGrouping] = useListGrouping(list.id, groups.length > 1);
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
  const actions = <ListMenu list={list} role={role} grouping={grouping} onGrouping={setGrouping} />;

  if (grouping === 'date') {
    return (
      <Page title={listName(list)} actions={actions}>
        {archivedBar}
        {header}
        <DateGroupedTasks filter={filter} emptyTitle={t('list.empty')} />
      </Page>
    );
  }

  const zone = (sectionId: string | null) =>
    canEdit ? { dragZone: { listId: list.id, sectionId } } : {};
  const content = (
    <>
      {empty && groups.length === 1 && completed.length === 0 && (
        <EmptyState title={t('list.empty')} />
      )}
      {groups.map((group) => {
        const section = group.sectionId ? getEntity(workspace, 'sections', group.sectionId) : null;
        if (!section) return <TaskTree key="none" tasks={group.tasks} {...zone(null)} />;
        return (
          <GroupSection
            key={section.id}
            title={section.name}
            count={group.tasks.length}
            {...(canEdit
              ? {
                  actions: (
                    <SectionActions section={section} onAdd={() => setAddingTo(section.id)} />
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
    </>
  );

  return (
    <Page title={listName(list)} actions={actions}>
      {archivedBar}
      {header}
      {canEdit ? <TaskDragProvider>{content}</TaskDragProvider> : content}
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
