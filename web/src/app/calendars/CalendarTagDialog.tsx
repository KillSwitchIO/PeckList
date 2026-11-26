import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  MenuItem,
  TextField,
} from '@mui/material';
import { useState, type FormEvent } from 'react';
import { findInbox, visibleLists } from '../../core/lists.ts';
import { canEditList } from '../../core/sharing.ts';
import { createTag, visibleTags } from '../../core/tags.ts';
import type { Tag } from '../../core/types.ts';
import type { CalendarResult } from '../../ports/calendars.ts';
import { t } from '../i18n/i18n.ts';
import { ProblemAlert } from '../layout/ProblemAlert.tsx';
import { listName } from '../lists/listName.ts';
import { useApply, useStoreState, useWorkspace } from '../store/hooks.ts';
import { useSyncState } from '../sync/syncContext.ts';
import { problemText } from './calendarText.ts';

const NEW_TAG = '__new';

/**
 * Pick the tag a calendar syncs with and the list its events land in as tasks (spec: PL-134
 * decision 3, "a tag decides what syncs, both ways"); with `name`, also what a new PeckList
 * calendar is called. A new tag is made here and synced first, so the server knows it.
 */
export function CalendarTagDialog({
  title,
  text,
  action,
  name: initialName,
  initialTag,
  initialList,
  run,
  onClose,
}: {
  title: string;
  text: string;
  action: string;
  /** Ask for the new calendar's name too, starting with this */
  name?: string;
  initialTag?: string | null;
  initialList?: string | null;
  run: (choice: {
    name: string;
    tagId: string;
    listId?: string;
  }) => Promise<CalendarResult<unknown>>;
  onClose: () => void;
}) {
  const workspace = useWorkspace();
  const apply = useApply();
  const me = useStoreState((state) => state.context().userId);
  const syncNow = useSyncState((state) => state.syncNow);
  const tags = visibleTags(workspace);
  const lists = visibleLists(workspace).filter((list) => canEditList(workspace, me, list.id));
  const inbox = findInbox(workspace);
  const [name, setName] = useState(initialName ?? '');
  const [tag, setTag] = useState(initialTag ?? tags[0]?.id ?? NEW_TAG);
  const [newTag, setNewTag] = useState('');
  const [list, setList] = useState(initialList ?? inbox?.id ?? lists[0]?.id ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const asksName = initialName !== undefined;
  const ready =
    (!asksName || name.trim() !== '') && (tag !== NEW_TAG || newTag.trim() !== '') && list !== '';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      let tagId = tag;
      if (tag === NEW_TAG) {
        let made: Tag | null = null;
        apply((ctx, ws) => {
          const result = createTag(ctx, ws, newTag);
          made = result.tag;
          return result.workspace;
        });
        tagId = (made as Tag | null)?.id ?? '';
        setTag(tagId);
        // The server checks the tag is one this person can see: it must have it first.
        await syncNow();
      }
      // The Inbox is the server's default: say a list only when it is another.
      const listId = list && list !== inbox?.id ? list : undefined;
      const result = await run({ name: name.trim(), tagId, ...(listId ? { listId } : {}) });
      if (result.ok) {
        onClose();
        return;
      }
      setProblem(problemText(result.code));
    } catch {
      setProblem(t('calendars.problem.offline'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <Box component="form" onSubmit={(event) => void submit(event)}>
        <DialogTitle>{title}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2 }}>
          <DialogContentText>{text}</DialogContentText>
          {asksName && (
            <TextField
              size="small"
              label={t('calendars.tag.name')}
              value={name}
              onChange={(change) => setName(change.target.value)}
              slotProps={{ htmlInput: { maxLength: 256 } }}
            />
          )}
          <TextField
            select
            size="small"
            label={t('calendars.tag.tag')}
            value={tag}
            onChange={(change) => setTag(change.target.value)}
          >
            {tags.map((each) => (
              <MenuItem key={each.id} value={each.id}>
                {each.name}
              </MenuItem>
            ))}
            <MenuItem value={NEW_TAG}>{t('calendars.tag.newTag')}</MenuItem>
          </TextField>
          {tag === NEW_TAG && (
            <TextField
              size="small"
              autoFocus
              label={t('calendars.tag.newTagName')}
              value={newTag}
              onChange={(change) => setNewTag(change.target.value)}
            />
          )}
          <TextField
            select
            size="small"
            label={t('calendars.tag.list')}
            helperText={t('calendars.tag.listHint')}
            value={list}
            onChange={(change) => setList(change.target.value)}
          >
            {lists.map((each) => (
              <MenuItem key={each.id} value={each.id}>
                {listName(each, workspace)}
              </MenuItem>
            ))}
          </TextField>
          <ProblemAlert problem={problem} />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>
            {t('admin.cancel')}
          </Button>
          <Button type="submit" variant="contained" disableElevation disabled={!ready || busy}>
            {action}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
