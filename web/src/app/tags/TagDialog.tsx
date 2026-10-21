import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Popper,
  Stack,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { useState } from 'react';
import { chipColors } from '../../core/palette.ts';
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
import { ColorPicker } from '../colors/ColorPicker.tsx';
import { t } from '../i18n/i18n.ts';
import { useWorkspace } from '../store/hooks.ts';

export interface TagFormValue {
  /** Full path, parent included */
  name: string;
  color: string;
}

const MAX_SUGGESTIONS = 6;

/**
 * Create or edit a tag: name, where it nests, color.
 *
 * The Name field takes a whole path ("home/test/deep"). While it holds one, Nest under is
 * greyed out and blank; when Name loses focus the path splits into Nest under + the last
 * segment. Focusing Name again joins them back, so the field shows the full path while
 * editing. Matching tags drop down as you type: arrows to move, Tab or Enter to take one.
 */
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
  const theme = useTheme();
  const [name, setName] = useState(tag ? leafName(tag.name) : '');
  const [parent, setParent] = useState(tag ? parentTagPath(tag.name) : '');
  // Until the user picks a color, follow the suggestion for wherever the tag will nest.
  const [picked, setPicked] = useState<string | null>(tag?.color ?? null);
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  // State, not a ref: the suggestion list re-renders once the field it hangs from exists.
  const [field, setField] = useState<HTMLDivElement | null>(null);

  // A tag cannot nest under itself or its own children.
  const parents = tagTree(workspace).filter((node) => !tag || !isUnder(node.tag.name, tag.name));
  const hasPath = name.includes('/');
  const cut = name.lastIndexOf('/');
  const nest = hasPath ? normalizeTagName(name.slice(0, cut)) : parent;
  const leaf = normalizeTagName(hasPath ? name.slice(cut + 1) : name);
  const full = leaf ? (nest ? `${nest}/${leaf}` : leaf) : '';
  const preview = full || (nest ? `${nest}/` : '');
  const color = picked ?? suggestTagColor(workspace, nest ? `${nest}/new` : 'new');

  const taken = full !== '' && tagNameTaken(workspace, full, tag?.id);
  const selfNest = tag !== undefined && nest !== '' && isUnder(nest, tag.name);
  const valid = full !== '' && !taken && !selfNest;
  const error = taken ? t('tag.taken') : selfNest ? t('tag.selfNest') : undefined;

  const query = name.trim().toLowerCase();
  const suggestions = query
    ? parents
        .map((node) => node.tag.name)
        .filter((path) => path.includes(query) && path !== normalizeTagName(query))
        .sort((a, b) => Number(!a.startsWith(query)) - Number(!b.startsWith(query)))
        .slice(0, MAX_SUGGESTIONS)
    : [];
  const listOpen = focused && !dismissed && suggestions.length > 0;

  const typeName = (text: string) => {
    setName(text.toLowerCase());
    setHighlight(-1);
    setDismissed(false);
  };
  // Taking a suggestion fills its path and a slash, ready for the next segment.
  const accept = (path: string) => typeName(`${path}/`);
  // Focus shows the whole path in Name ...
  const joinPath = () => {
    setFocused(true);
    if (parent && !hasPath) setName(`${parent}/${name}`);
  };
  // ... and leaving it splits the path into Nest under + the last segment.
  const splitPath = () => {
    setFocused(false);
    if (!hasPath) return;
    setParent(nest);
    setName(name.slice(cut + 1).trim());
  };

  const { bg, fg } = chipColors(color, theme.palette.mode);

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) onSubmit({ name: full, color });
        }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box component="span" sx={{ flexShrink: 0 }}>
            {tag ? t('tag.edit') : t('tag.new')}
          </Box>
          <Box sx={{ flexGrow: 1 }} />
          {preview && (
            <Box
              component="span"
              data-testid="tag-preview"
              aria-label={t('tag.preview', { path: preview })}
              title={preview}
              sx={{
                minWidth: 0,
                px: 1,
                lineHeight: '24px',
                borderRadius: '12px',
                bgcolor: bg,
                color: fg,
                typography: 'body2',
                fontWeight: 500,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                // rtl keeps the end of a long path in view; the bdi keeps the text order.
                direction: 'rtl',
                textAlign: 'left',
              }}
            >
              <bdi>#{preview}</bdi>
            </Box>
          )}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              ref={setField}
              label={t('tag.name')}
              value={name}
              autoFocus
              autoComplete="off"
              error={error !== undefined}
              helperText={error}
              onChange={(event) => typeName(event.target.value)}
              onFocus={joinPath}
              onBlur={splitPath}
              onKeyDown={(event) => {
                if (!listOpen) {
                  if (event.key === 'ArrowDown' && suggestions.length > 0) {
                    event.preventDefault();
                    setDismissed(false);
                    setHighlight(0);
                  }
                  return;
                }
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setHighlight((index) => Math.min(index + 1, suggestions.length - 1));
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setHighlight((index) => Math.max(index - 1, -1));
                } else if ((event.key === 'Tab' || event.key === 'Enter') && highlight >= 0) {
                  event.preventDefault();
                  accept(suggestions[highlight]!);
                } else if (event.key === 'Escape') {
                  // Close the list, not the dialog.
                  event.preventDefault();
                  event.stopPropagation();
                  setDismissed(true);
                }
              }}
              slotProps={{
                htmlInput: {
                  role: 'combobox',
                  'aria-expanded': listOpen,
                  'aria-controls': 'tag-path-suggestions',
                  'aria-autocomplete': 'list',
                  'aria-activedescendant':
                    listOpen && highlight >= 0 ? `tag-path-suggestion-${highlight}` : undefined,
                },
              }}
            />
            <Popper
              open={listOpen && field !== null}
              anchorEl={field}
              placement="bottom-start"
              sx={{ zIndex: theme.zIndex.modal + 1, width: field?.clientWidth }}
            >
              <Paper elevation={6} sx={{ borderRadius: 2, mt: 0.5, py: 0.5 }}>
                <Box component="ul" role="listbox" id="tag-path-suggestions" sx={{ m: 0, p: 0 }}>
                  {suggestions.map((path, index) => (
                    <Box
                      component="li"
                      key={path}
                      id={`tag-path-suggestion-${index}`}
                      role="option"
                      aria-selected={index === highlight}
                      // Keep focus in Name so typing can carry on.
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => accept(path)}
                      sx={{
                        listStyle: 'none',
                        px: 2,
                        py: 0.75,
                        cursor: 'pointer',
                        typography: 'body2',
                        bgcolor: index === highlight ? 'action.selected' : 'transparent',
                        '&:hover': { bgcolor: 'action.hover' },
                      }}
                    >
                      #{path}
                    </Box>
                  ))}
                </Box>
              </Paper>
            </Popper>
            <TextField
              select
              label={t('tag.parent')}
              value={hasPath ? '' : parent}
              disabled={hasPath}
              slotProps={{
                select: { displayEmpty: !hasPath },
                inputLabel: hasPath ? {} : { shrink: true },
              }}
              onChange={(event) => setParent(event.target.value)}
            >
              <MenuItem value="">{t('tag.noParent')}</MenuItem>
              {/* A parent path with no tag of its own (new, or after an import) stays selectable. */}
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
