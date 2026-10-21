import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { isUnder, leafName, normalizeTagName, tagNameTaken, tagTree } from '../../core/tags.ts';
import type { Tag } from '../../core/types.ts';
import { t } from '../i18n/i18n.ts';
import { ColorSwatches } from '../lists/ListDialog.tsx';
import { useWorkspace } from '../store/hooks.ts';
import { nextTagColor } from './tagColors.ts';

export interface TagFormValue {
  /** Full path, parent included */
  name: string;
  color: string;
}

function parentPath(name: string): string {
  const cut = name.lastIndexOf('/');
  return cut < 0 ? '' : name.slice(0, cut);
}

/** Create or edit a tag: name, where it nests, color. */
export function TagDialog({
  tag,
  onClose,
  onSubmit,
}: {
  tag?: Tag;
  onClose: () => void;
  onSubmit: (value: TagFormValue) => void;
}) {
  const workspace = useWorkspace();
  const [name, setName] = useState(tag ? leafName(tag.name) : '');
  const [parent, setParent] = useState(tag ? parentPath(tag.name) : '');
  const [color, setColor] = useState(() => tag?.color ?? nextTagColor(workspace));

  // A tag cannot nest under itself or its own children.
  const parents = tagTree(workspace).filter((node) => !tag || !isUnder(node.tag.name, tag.name));
  const leaf = normalizeTagName(name.replaceAll('/', ' '));
  const full = parent ? `${parent}/${leaf}` : leaf;
  const taken = leaf.length > 0 && tagNameTaken(workspace, full, tag?.id);
  const valid = leaf.length > 0 && !taken;

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) onSubmit({ name: full, color });
        }}
      >
        <DialogTitle>{tag ? t('tag.edit') : t('tag.new')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label={t('tag.name')}
              value={name}
              autoFocus
              error={taken}
              helperText={taken ? t('tag.taken') : undefined}
              onChange={(event) => setName(event.target.value)}
            />
            <TextField
              select
              label={t('tag.parent')}
              value={parent}
              slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
              onChange={(event) => setParent(event.target.value)}
            >
              <MenuItem value="">{t('tag.noParent')}</MenuItem>
              {/* A parent path with no tag of its own (after an import) stays selectable. */}
              {parent && !parents.some((node) => node.tag.name === parent) && (
                <MenuItem value={parent}>{parent}</MenuItem>
              )}
              {parents.map((node) => (
                <MenuItem key={node.tag.id} value={node.tag.name} sx={{ pl: 2 + node.depth * 2 }}>
                  {leafName(node.tag.name)}
                </MenuItem>
              ))}
            </TextField>
            <Box>
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
                {t('list.color')}
              </Typography>
              <ColorSwatches value={color} onChange={setColor} />
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="contained" disabled={!valid}>
            {tag ? t('common.save') : t('common.create')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
