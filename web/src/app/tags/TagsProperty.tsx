import AddRounded from '@mui/icons-material/AddRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import LocalOfferOutlined from '@mui/icons-material/LocalOfferOutlined';
import LocalOfferRounded from '@mui/icons-material/LocalOfferRounded';
import {
  Box,
  InputBase,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  useTheme,
} from '@mui/material';
import { useState } from 'react';
import { members } from '../../core/ops.ts';
import {
  createTag,
  findTagByName,
  leafName,
  normalizeTagName,
  tagsOfTask,
  tagTree,
} from '../../core/tags.ts';
import { setTaskTag } from '../../core/tasks.ts';
import type { Task } from '../../core/types.ts';
import { t } from '../i18n/i18n.ts';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { PropertyRow, PropertySheet } from '../tasks/PropertyRow.tsx';
import { TagChips } from './TagChip.tsx';
import { nextTagColor, tagIconColor } from './tagColors.ts';

/** Search box over the tag tree; tap to toggle, Enter to pick the match or create the tag. */
function TagPicker({ task }: { task: Task }) {
  const workspace = useWorkspace();
  const apply = useApply();
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const selected = new Set(members(task.tags));
  const wanted = normalizeTagName(query);
  const nodes = tagTree(workspace).filter(
    (node) => !wanted || node.tag.name.toLowerCase().includes(wanted.toLowerCase()),
  );
  const exact = wanted ? findTagByName(workspace, wanted) : undefined;

  const toggle = (tagId: string) =>
    apply((ctx, ws) => setTaskTag(ctx, ws, task.id, tagId, !selected.has(tagId)));
  const create = () => {
    apply((ctx, ws) => {
      const result = createTag(ctx, ws, wanted, nextTagColor(ws));
      return setTaskTag(ctx, result.workspace, task.id, result.tag.id, true);
    });
    setQuery('');
  };

  return (
    <Box sx={{ width: { xs: '100%', sm: 300 }, maxWidth: '100%', py: 1 }}>
      <InputBase
        autoFocus
        fullWidth
        value={query}
        placeholder={t('tag.search')}
        inputProps={{ 'aria-label': t('tag.search') }}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || !wanted) return;
          event.preventDefault();
          if (exact) {
            toggle(exact.id);
            setQuery('');
          } else {
            create();
          }
        }}
        sx={{ px: 2, py: 0.5 }}
      />
      <List dense sx={{ maxHeight: 320, overflowY: 'auto', py: 0 }}>
        {nodes.map((node) => {
          const checked = selected.has(node.tag.id);
          return (
            <ListItemButton
              key={node.tag.id}
              role="checkbox"
              aria-checked={checked}
              onClick={() => toggle(node.tag.id)}
              // While searching, show full paths flat; otherwise indent the tree.
              sx={{ pl: 2 + (wanted ? 0 : node.depth * 2) }}
            >
              <ListItemIcon sx={{ minWidth: 28 }}>
                <LocalOfferRounded
                  sx={{
                    fontSize: 14,
                    color: tagIconColor(node.tag.color, theme.palette.background.default),
                  }}
                />
              </ListItemIcon>
              <ListItemText primary={wanted ? node.tag.name : leafName(node.tag.name)} />
              {checked && <CheckRounded fontSize="small" color="primary" />}
            </ListItemButton>
          );
        })}
        {wanted && !exact && (
          <ListItemButton onClick={create}>
            <ListItemIcon sx={{ minWidth: 28 }}>
              <AddRounded fontSize="small" />
            </ListItemIcon>
            <ListItemText primary={t('tag.create', { name: wanted })} />
          </ListItemButton>
        )}
      </List>
      {nodes.length === 0 && !wanted && (
        <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1 }}>
          {t('tag.none')}
        </Typography>
      )}
    </Box>
  );
}

/** "Tags" row in the task details: the task's chips, opening the picker. */
export function TagsProperty({ task }: { task: Task }) {
  const workspace = useWorkspace();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const tags = tagsOfTask(workspace, task);
  const label = t('task.tags');
  return (
    <>
      <PropertyRow
        label={label}
        icon={<LocalOfferOutlined fontSize="small" />}
        ariaValue={tags.length ? tags.map((tag) => tag.name).join(', ') : t('task.addTags')}
        onClick={setAnchor}
      >
        {tags.length ? (
          <TagChips tags={tags} />
        ) : (
          <Typography color="text.disabled">{t('task.addTags')}</Typography>
        )}
      </PropertyRow>
      <PropertySheet label={label} anchor={anchor} onClose={() => setAnchor(null)}>
        {anchor && <TagPicker task={task} />}
      </PropertySheet>
    </>
  );
}
