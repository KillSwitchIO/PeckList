import AddRounded from '@mui/icons-material/AddRounded';
import ArchiveRounded from '@mui/icons-material/ArchiveRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import PlaylistAddRounded from '@mui/icons-material/PlaylistAddRounded';
import { IconButton, Menu, MenuItem, Tooltip } from '@mui/material';
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
import { completedTasks, listTasks } from '../../core/queries.ts';
import type { List, Section } from '../../core/types.ts';
import { t } from '../i18n/i18n.ts';
import { Page } from '../layout/Page.tsx';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { AddTaskInput } from '../tasks/AddTaskInput.tsx';
import { TaskTree } from '../tasks/TaskTree.tsx';
import { EmptyState } from '../views/EmptyState.tsx';
import { GroupSection } from '../views/GroupSection.tsx';
import { CompletedGroup } from '../views/TaskViews.tsx';
import { ConfirmDialog, ListDialog, NameDialog } from './ListDialog.tsx';
import { listName } from './listName.ts';

function ListMenu({ list }: { list: List }) {
  const apply = useApply();
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [dialog, setDialog] = useState<'edit' | 'section' | 'delete' | null>(null);
  const close = () => setAnchor(null);
  return (
    <>
      <Tooltip title={t('common.more')} disableFocusListener>
        <IconButton
          aria-label={t('common.more')}
          onClick={(event) => setAnchor(event.currentTarget)}
        >
          <MoreVertRounded />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={close}>
        <MenuItem
          onClick={() => {
            close();
            setDialog('edit');
          }}
        >
          <EditRounded fontSize="small" sx={{ mr: 1 }} />
          {t('list.edit')}
        </MenuItem>
        <MenuItem
          onClick={() => {
            close();
            setDialog('section');
          }}
        >
          <PlaylistAddRounded fontSize="small" sx={{ mr: 1 }} />
          {t('list.addSection')}
        </MenuItem>
        {!list.isInbox && (
          <MenuItem
            onClick={() => {
              close();
              apply(
                (ctx, ws) => updateList(ctx, ws, list.id, { archived: true }),
                t('undo.listArchived'),
              );
              void navigate('/inbox');
            }}
          >
            <ArchiveRounded fontSize="small" sx={{ mr: 1 }} />
            {t('list.archive')}
          </MenuItem>
        )}
        {!list.isInbox && (
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
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const groups = listTasks(workspace, list.id);
  const completed = completedTasks(workspace, list.id).filter((task) => task.parentId === null);
  const empty = groups.every((group) => group.tasks.length === 0);

  return (
    <Page title={listName(list)} actions={<ListMenu list={list} />}>
      <AddTaskInput
        defaults={{ listId: list.id }}
        label={t('task.addTo', { list: listName(list) })}
      />
      {empty && groups.length === 1 && completed.length === 0 && (
        <EmptyState title={t('list.empty')} />
      )}
      {groups.map((group) => {
        const section = group.sectionId ? getEntity(workspace, 'sections', group.sectionId) : null;
        if (!section) return <TaskTree key="none" tasks={group.tasks} />;
        return (
          <GroupSection
            key={section.id}
            title={section.name}
            count={group.tasks.length}
            actions={<SectionActions section={section} onAdd={() => setAddingTo(section.id)} />}
          >
            {addingTo === section.id && (
              <AddTaskInput defaults={{ listId: list.id, sectionId: section.id }} autoFocus />
            )}
            <TaskTree tasks={group.tasks} />
          </GroupSection>
        );
      })}
      <CompletedGroup tasks={completed} defaultOpen={false} />
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
