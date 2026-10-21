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
import {
  isUnder,
  leafName,
  normalizeTagName,
  parentTagPath,
  suggestTagColor,
  tagNameTaken,
  tagTree,
} from '../../core/tags.ts';
import type { Tag } from '../../core/types.ts';
import { t } from '../i18n/i18n.ts';
import { ColorPicker } from '../colors/ColorPicker.tsx';
import { useWorkspace } from '../store/hooks.ts';

export interface TagFormValue {
  /** Full path, parent included */
  name: string;
  color: string;
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
  const [parent, setParent] = useState(tag ? parentTagPath(tag.name) : '');
  // Until the user picks a color, follow the suggestion for wherever the tag will nest.
  const [picked, setPicked] = useState<string | null>(tag?.color ?? null);
  const color = picked ?? suggestTagColor(workspace, parent ? `${parent}/new` : 'new');

  // A tag cannot nest under itself or its own children.
  const parents = tagTree(workspace).filter((node) => !tag || !isUnder(node.tag.name, tag.name));
  const leaf = normalizeTagName(name.replaceAll('/', ' '));
  const full = parent ? `${parent}/${leaf}` : leaf;
  const taken = leaf.length > 0 && tagNameTaken(workspace, full, tag?.id);
  const selfNest = tag !== undefined && parent !== '' && isUnder(parent, tag.name);
  const valid = leaf.length > 0 && !taken && !selfNest;
  const error = taken ? t('tag.taken') : selfNest ? t('tag.selfNest') : undefined;

  // Typing a path nests it: "home/test" moves "home" into Nest under and keeps "test" here.
  const typeName = (text: string) => {
    const lower = text.toLowerCase();
    const cut = lower.lastIndexOf('/');
    if (cut < 0) {
      setName(lower);
      return;
    }
    setParent(normalizeTagName([parent, lower.slice(0, cut)].filter(Boolean).join('/')));
    setName(lower.slice(cut + 1));
  };

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
              error={error !== undefined}
              helperText={error}
              onChange={(event) => typeName(event.target.value)}
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
                <MenuItem value={parent}>{t('tag.newParent', { path: parent })}</MenuItem>
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
              <ColorPicker value={color} onChange={setPicked} />
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
