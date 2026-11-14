import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import { MenuItem } from '@mui/material';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { getEntity, isLive } from '../../core/collections.ts';
import { findInbox } from '../../core/lists.ts';
import { deleteTag, leafName, updateTag } from '../../core/tags.ts';
import type { Tag } from '../../core/types.ts';
import { t } from '../i18n/i18n.ts';
import { Page } from '../layout/Page.tsx';
import { ConfirmDialog } from '../lists/ListDialog.tsx';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { AddTaskInput } from '../tasks/AddTaskInput.tsx';
import { EmptyState } from '../views/EmptyState.tsx';
import { FilteredTasks } from '../views/groups.tsx';
import { SortGroupButton } from '../views/SortGroupButton.tsx';
import { useListView, type ListViewSettings } from '../lists/listGrouping.ts';
import { VIEW_GROUPINGS } from '../../core/listView.ts';
import { TagDialog } from './TagDialog.tsx';

/** The tag's own actions (edit, delete), joining the one view menu. */
function TagMenu({ tag, view }: { tag: Tag; view: ListViewSettings }) {
  const apply = useApply();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<'edit' | 'delete' | null>(null);
  return (
    <>
      <SortGroupButton
        view={view}
        groupings={VIEW_GROUPINGS}
        extra={(close) => [
          <MenuItem
            key="edit"
            onClick={() => {
              close();
              setDialog('edit');
            }}
          >
            <EditRounded fontSize="small" sx={{ mr: 1 }} />
            {t('tag.edit')}
          </MenuItem>,
          <MenuItem
            key="delete"
            onClick={() => {
              close();
              setDialog('delete');
            }}
          >
            <DeleteOutlineRounded fontSize="small" sx={{ mr: 1 }} />
            {t('tag.delete')}
          </MenuItem>,
        ]}
      />
      {dialog === 'edit' && (
        <TagDialog
          tag={tag}
          onClose={() => setDialog(null)}
          onSubmit={(value) => {
            apply((ctx, ws) => updateTag(ctx, ws, tag.id, value));
            setDialog(null);
          }}
        />
      )}
      {dialog === 'delete' && (
        <ConfirmDialog
          open
          message={t('tag.deleteConfirm', { name: tag.name })}
          confirmLabel={t('common.delete')}
          onClose={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null);
            apply((ctx, ws) => deleteTag(ctx, ws, tag.id), t('undo.tagDeleted'));
            void navigate('/today');
          }}
        />
      )}
    </>
  );
}

/** Every open task carrying the tag or one nested under it, across lists. */
function TagContents({ tag }: { tag: Tag }) {
  const view = useListView(`tag:${tag.id}`);
  const workspace = useWorkspace();
  const name = leafName(tag.name);
  const inbox = findInbox(workspace);
  return (
    <Page title={name} actions={<TagMenu tag={tag} view={view} />}>
      {inbox && (
        <AddTaskInput
          defaults={{ listId: inbox.id, tags: [tag.id] }}
          label={t('tag.addTo', { tag: name })}
        />
      )}
      <FilteredTasks filter={{ tags: [tag.id] }} view={view} showList emptyTitle={t('tag.empty')} />
    </Page>
  );
}

export function TagView() {
  const workspace = useWorkspace();
  const { tagId } = useParams();
  const tag = tagId ? getEntity(workspace, 'tags', tagId) : undefined;
  if (!tag || !isLive(tag)) {
    return (
      <Page title={t('nav.tags')}>
        <EmptyState title={t('tag.notFound')} />
      </Page>
    );
  }
  return <TagContents key={tag.id} tag={tag} />;
}
