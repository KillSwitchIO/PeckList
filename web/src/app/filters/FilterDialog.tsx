// Make or edit a saved filter: a name, then any of lists, tags, a start-date window and
// priorities. Empty parts don't narrow anything.

import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  FormControlLabel,
  DialogContent,
  DialogTitle,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useTheme,
} from '@mui/material';
import { submitOnShiftEnter } from '../hooks/keys.ts';
import { useState, type ReactNode } from 'react';
import type { TaskFilter } from '../../core/filters.ts';
import { visibleLists } from '../../core/lists.ts';
import {
  DATE_CHOICES,
  dateChoiceOf,
  DUE_CHOICES,
  dueChoiceOf,
  type DateChoice,
  type DueChoice,
} from '../../core/savedFilters.ts';
import { groupsOf } from '../../core/groups.ts';
import { friendsOf, nameOf } from '../../core/sharing.ts';
import { tagTree } from '../../core/tags.ts';
import type { Priority } from '../../core/types.ts';
import { t } from '../i18n/i18n.ts';
import { FlagIcon } from '../icons/icons.tsx';
import { listName } from '../lists/listName.ts';
import { useStoreState, useWorkspace } from '../store/hooks.ts';
import { TagChip } from '../tags/TagChip.tsx';

const PRIORITIES: Priority[] = [3, 2, 1, 0];
const PRIORITY_KEY = { 0: 'none', 1: 'low', 2: 'medium', 3: 'high' } as const;
const DATE_ORDER: DateChoice[] = ['any', 'overdue', 'today', 'week', 'later', 'undated'];
const DUE_ORDER: DueChoice[] = ['any', 'overdue', 'today', 'week', 'later', 'none'];
const STATES = ['late', 'slipped', 'dueSoon'] as const;
type State = (typeof STATES)[number];

function toggle<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((each) => each !== value) : [...values, value];
}

function Part({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.75 }}>
        {label}
      </Typography>
      {children}
    </Box>
  );
}

export function FilterDialog({
  initial,
  onSave,
  onClose,
}: {
  /** An existing filter to edit; none makes a new one. */
  initial?: { name: string; filter: TaskFilter };
  onSave: (name: string, filter: TaskFilter) => void;
  onClose: () => void;
}) {
  const workspace = useWorkspace();
  const theme = useTheme();
  const [name, setName] = useState(initial?.name ?? '');
  const [lists, setLists] = useState<string[]>(initial?.filter.lists ?? []);
  const [tags, setTags] = useState<string[]>(initial?.filter.tags ?? []);
  const [date, setDate] = useState<DateChoice>(initial ? dateChoiceOf(initial.filter) : 'any');
  const [priorities, setPriorities] = useState<Priority[]>(initial?.filter.priorities ?? []);
  const [due, setDue] = useState<DueChoice>(initial ? dueChoiceOf(initial.filter) : 'any');
  const [closed, setClosed] = useState(initial?.filter.closed !== false);
  const [states, setStates] = useState<State[]>(initial?.filter.states ?? []);
  const [assignees, setAssignees] = useState<string[]>(initial?.filter.assignees ?? []);
  const me = useStoreState((state) => state.context().userId);
  // Who tasks can be assigned to: me, nobody, and the friends and groups I share with.
  const people = [
    { value: 'me', label: t('filter.assignees.me') },
    { value: 'none', label: t('filter.assignees.none') },
    ...friendsOf(workspace, me)
      .filter((friend) => friend.state === 'accepted')
      .map((friend) => ({
        value: `user:${friend.userId}`,
        label: nameOf(friend.user, friend.userId),
      })),
    ...groupsOf(workspace, me)
      .filter((view) => view.mine?.state === 'active')
      .map((view) => ({ value: `group:${view.group.id}`, label: view.group.name })),
  ];
  const valid = name.trim() !== '';

  const save = () => {
    if (!valid) return;
    onSave(name, {
      ...(lists.length ? { lists } : {}),
      ...(tags.length ? { tags } : {}),
      ...(priorities.length ? { priorities } : {}),
      ...DATE_CHOICES[date],
      ...DUE_CHOICES[due],
      ...(closed ? {} : { closed: false }),
      ...(states.length ? { states } : {}),
      ...(assignees.length ? { assignees } : {}),
    });
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <form
        onKeyDown={submitOnShiftEnter}
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <DialogTitle>{initial ? t('filter.edit') : t('filter.new')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <TextField
              label={t('filter.name')}
              value={name}
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
            <Part label={t('filter.lists')}>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {visibleLists(workspace).map((list) => (
                  <Chip
                    key={list.id}
                    label={listName(list)}
                    size="small"
                    variant={lists.includes(list.id) ? 'filled' : 'outlined'}
                    color={lists.includes(list.id) ? 'primary' : 'default'}
                    aria-pressed={lists.includes(list.id)}
                    onClick={() => setLists(toggle(lists, list.id))}
                  />
                ))}
              </Box>
            </Part>
            <Part label={t('filter.tags')}>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {tagTree(workspace).length === 0 && (
                  <Typography variant="body2" color="text.disabled">
                    {t('tag.none')}
                  </Typography>
                )}
                {tagTree(workspace).map(({ tag }) => (
                  <Box
                    key={tag.id}
                    component="button"
                    type="button"
                    aria-pressed={tags.includes(tag.id)}
                    aria-label={tag.name}
                    onClick={() => setTags(toggle(tags, tag.id))}
                    sx={{
                      p: 0,
                      border: 0,
                      bgcolor: 'transparent',
                      borderRadius: '12px',
                      cursor: 'pointer',
                      opacity: tags.includes(tag.id) ? 1 : 0.5,
                      outline: tags.includes(tag.id)
                        ? `2px solid ${theme.palette.primary.main}`
                        : 'none',
                      outlineOffset: 1,
                    }}
                  >
                    <TagChip tag={tag} size="medium" />
                  </Box>
                ))}
              </Box>
            </Part>
            <Part label={t('filter.date')}>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={date}
                aria-label={t('filter.date')}
                onChange={(_, value: DateChoice | null) => value && setDate(value)}
                sx={{ flexWrap: 'wrap' }}
              >
                {DATE_ORDER.map((choice) => (
                  <ToggleButton key={choice} value={choice}>
                    {t(`filter.date.${choice}`)}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Part>
            <Part label={t('filter.due')}>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={due}
                aria-label={t('filter.due')}
                onChange={(_, value: DueChoice | null) => value && setDue(value)}
                sx={{ flexWrap: 'wrap' }}
              >
                {DUE_ORDER.map((choice) => (
                  <ToggleButton key={choice} value={choice}>
                    {t(`filter.due.${choice}`)}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Part>
            <Part label={t('task.priority')}>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {PRIORITIES.map((priority) => (
                  <Chip
                    key={priority}
                    size="small"
                    icon={
                      <FlagIcon
                        filled={priority !== 0}
                        sx={{
                          fontSize: '16px !important',
                          color: `${
                            priority === 0
                              ? theme.palette.text.secondary
                              : theme.punchlist.priority[PRIORITY_KEY[priority]].fill
                          } !important`,
                        }}
                      />
                    }
                    label={t(`priority.${priority}`)}
                    variant={priorities.includes(priority) ? 'filled' : 'outlined'}
                    color={priorities.includes(priority) ? 'primary' : 'default'}
                    aria-pressed={priorities.includes(priority)}
                    onClick={() => setPriorities(toggle(priorities, priority))}
                  />
                ))}
              </Box>
            </Part>
            <Part label={t('filter.states')}>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {STATES.map((state) => (
                  <Chip
                    key={state}
                    size="small"
                    label={t(`filter.state.${state}`)}
                    variant={states.includes(state) ? 'filled' : 'outlined'}
                    color={states.includes(state) ? 'primary' : 'default'}
                    aria-pressed={states.includes(state)}
                    onClick={() => setStates(toggle(states, state))}
                  />
                ))}
              </Box>
            </Part>
            <Part label={t('filter.assignees')}>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {people.map((person) => (
                  <Chip
                    key={person.value}
                    size="small"
                    label={person.label}
                    variant={assignees.includes(person.value) ? 'filled' : 'outlined'}
                    color={assignees.includes(person.value) ? 'primary' : 'default'}
                    aria-pressed={assignees.includes(person.value)}
                    onClick={() => setAssignees(toggle(assignees, person.value))}
                  />
                ))}
              </Box>
            </Part>
            <FormControlLabel
              control={
                <Switch checked={closed} onChange={(event) => setClosed(event.target.checked)} />
              }
              label={t('filter.closed')}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="contained" disabled={!valid}>
            {initial ? t('common.save') : t('filter.create')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
