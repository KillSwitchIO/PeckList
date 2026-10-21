import AddRounded from '@mui/icons-material/AddRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import TagRounded from '@mui/icons-material/TagRounded';
import {
  Box,
  ButtonBase,
  IconButton,
  InputBase,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { useState } from 'react';
import { useNavigate } from 'react-router';
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
import { CloseIcon, PlusIcon } from '../icons/icons.tsx';
import { PropertySheet } from '../tasks/PropertyRow.tsx';
import { TagChip } from './TagChip.tsx';
import { tagIconColor } from './tagColors.ts';

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
      const result = createTag(ctx, ws, wanted);
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
                <TagRounded
                  sx={{
                    fontSize: 16,
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

/**
 * "Tags" row in the task details: the task's tags as pills (click one to open that tag; hover for
 * an x that removes it) and a round + that opens the picker.
 */
export function TagsProperty({ task }: { task: Task }) {
  const workspace = useWorkspace();
  const apply = useApply();
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const tags = tagsOfTask(workspace, task);
  const label = t('task.tags');
  return (
    <>
      <Box
        role="group"
        aria-label={label}
        sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, px: 1, py: 0.75 }}
      >
        <Box sx={{ display: 'flex', color: 'text.secondary', py: '3px' }}>
          <TagRounded fontSize="small" />
        </Box>
        <Typography color="text.secondary" sx={{ width: 84, flexShrink: 0, lineHeight: '26px' }}>
          {label}
        </Typography>
        <Box
          sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75, minWidth: 0 }}
        >
          {tags.map((tag) => (
            <Box
              key={tag.id}
              sx={{
                position: 'relative',
                display: 'inline-flex',
                '& .remove': { opacity: 0, pointerEvents: 'none' },
                '&:hover .remove, &:focus-within .remove': { opacity: 1, pointerEvents: 'auto' },
                // No hover on touch screens: keep the x showing.
                '@media (hover: none)': { '& .remove': { opacity: 1, pointerEvents: 'auto' } },
              }}
            >
              <ButtonBase
                aria-label={t('tag.open', { name: tag.name })}
                onClick={() => void navigate(`/tags/${tag.id}`)}
                sx={{ borderRadius: '10px' }}
              >
                <TagChip tag={tag} size="medium" />
              </ButtonBase>
              <IconButton
                className="remove"
                aria-label={t('tag.remove', { name: tag.name })}
                onClick={() => apply((ctx, ws) => setTaskTag(ctx, ws, task.id, tag.id, false))}
                sx={{
                  position: 'absolute',
                  top: -7,
                  right: -7,
                  p: 0,
                  width: 16,
                  height: 16,
                  bgcolor: 'background.paper',
                  border: 1,
                  borderColor: 'divider',
                  color: 'text.secondary',
                  transition: 'opacity 120ms',
                  '&:hover': { bgcolor: 'background.paper', color: 'text.primary' },
                }}
              >
                <CloseIcon sx={{ fontSize: 10 }} />
              </IconButton>
            </Box>
          ))}
          <Tooltip title={t('task.addTags')}>
            <IconButton
              aria-label={t('task.addTags')}
              aria-haspopup="dialog"
              onClick={(event) => setAnchor(event.currentTarget)}
              sx={{
                width: 24,
                height: 24,
                p: 0,
                border: 1,
                borderColor: 'divider',
                color: 'text.secondary',
                '&:hover': { color: 'primary.main', borderColor: 'primary.main' },
              }}
            >
              <PlusIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
      <PropertySheet label={label} anchor={anchor} onClose={() => setAnchor(null)}>
        {anchor && <TagPicker task={task} />}
      </PropertySheet>
    </>
  );
}
