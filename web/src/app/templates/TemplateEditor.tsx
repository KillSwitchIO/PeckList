import {
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputBase,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useState, type ReactNode } from 'react';
import { isLive } from '../../core/collections.ts';
import { MAX_NOTES_LENGTH } from '../../core/tasks.ts';
import { formatRule, type Recurrence } from '../../core/recurrence.ts';
import {
  listBody,
  MAX_TEMPLATE_TASKS,
  renameTemplate,
  taskBody,
  updateTemplateBody,
  blankTask,
  templateFits,
} from '../../core/templates.ts';
import type {
  Priority,
  Template,
  TemplateDate,
  TemplateList,
  TemplateTask,
} from '../../core/types.ts';
import { ColorPicker } from '../colors/ColorPicker.tsx';
import { NotesEditor } from '../editor/NotesEditor.tsx';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  DeleteIcon,
  FlagIcon,
} from '../icons/icons.tsx';
import { IconPicker } from '../lists/IconPicker.tsx';
import { repeatLabel } from '../repeat/repeatText.ts';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { relativeDay } from './templateSummary.ts';

type Body = TemplateTask | TemplateList;

/** The tasks at the top of a body: a list's tasks, or a task template's subtasks. */
const topOf = (body: Body): TemplateTask[] => ('tasks' in body ? body.tasks : body.subtasks);

/** The task a path of indexes points to; the empty path is a task template's own task. */
function nodeAt(body: Body, path: number[]): TemplateTask | null {
  if (path.length === 0) return 'tasks' in body ? null : body;
  let node: TemplateTask | undefined = topOf(body)[path[0]!];
  for (const index of path.slice(1)) node = node?.subtasks[index];
  return node ?? null;
}

function withTasks(
  tasks: TemplateTask[],
  path: number[],
  change: (task: TemplateTask) => TemplateTask,
): TemplateTask[] {
  const [index, ...rest] = path;
  return tasks.map((task, at): TemplateTask =>
    at !== index
      ? task
      : rest.length === 0
        ? change(task)
        : { ...task, subtasks: withTasks(task.subtasks, rest, change) },
  );
}

function updateAt(body: Body, path: number[], change: (task: TemplateTask) => TemplateTask): Body {
  if (path.length === 0) return 'tasks' in body ? body : change(body);
  return 'tasks' in body
    ? { ...body, tasks: withTasks(body.tasks, path, change) }
    : { ...body, subtasks: withTasks(body.subtasks, path, change) };
}

function countTasks(tasks: TemplateTask[]): number {
  return tasks.reduce((sum, task) => sum + 1 + countTasks(task.subtasks), 0);
}

const PRIORITIES: Priority[] = [3, 2, 1, 0];
const PRIORITY_KEY = { 0: 'none', 1: 'low', 2: 'medium', 3: 'high' } as const;

/** The repeats a template offers; each runs from the date the used task gets. */
const REPEATS: Recurrence[] = [
  { freq: 'DAILY', interval: 1 },
  { freq: 'WEEKLY', interval: 1 },
  { freq: 'WEEKLY', interval: 1, byDay: [1, 2, 3, 4, 5].map((weekday) => ({ weekday })) },
  { freq: 'MONTHLY', interval: 1 },
  { freq: 'YEARLY', interval: 1 },
];

/**
 * Edit a template (PL-140): its name, then the task or list it makes, the way the task screen
 * shows a task but with dates as days from the day it is used. Subtasks (and a list's tasks) open
 * in place, with a back button. Nothing is saved until Save.
 */
export function TemplateEditor({ template, onClose }: { template: Template; onClose: () => void }) {
  const apply = useApply();
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const [name, setName] = useState(template.name);
  const [body, setBody] = useState<Body>(
    () => taskBody(template) ?? listBody(template) ?? blankTask(),
  );
  const [path, setPath] = useState<number[]>([]);
  const node = nodeAt(body, path);
  const fits = templateFits(body);
  const room = MAX_TEMPLATE_TASKS - countTasks(topOf(body));
  const change = (update: (task: TemplateTask) => TemplateTask) =>
    setBody((was) => updateAt(was, path, update));
  const save = () => {
    apply((ctx, ws) => {
      const next = updateTemplateBody(ctx, ws, template.id, body);
      return name.trim() && name !== template.name
        ? renameTemplate(ctx, next, template.id, name)
        : next;
    });
    onClose();
  };
  const heading = path.length === 0 ? t('templates.edit') : node?.title || t('templates.untitled');

  return (
    <Dialog open onClose={onClose} fullScreen={phone} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {path.length > 0 && (
          <IconButton
            edge="start"
            aria-label={t('common.back')}
            onClick={() => setPath(path.slice(0, -1))}
          >
            <ChevronLeftIcon />
          </IconButton>
        )}
        <Box
          component="span"
          sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {heading}
        </Box>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ pt: 0.5 }}>
          {path.length === 0 && (
            <TextField
              label={t('templates.name')}
              value={name}
              onChange={(event) => setName(event.target.value)}
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
          )}
          {node ? (
            <TaskFields
              key={path.join('.')}
              task={node}
              room={room}
              onChange={change}
              onOpen={(index) => setPath([...path, index])}
            />
          ) : (
            'tasks' in body && (
              <ListFields
                list={body}
                room={room}
                onChange={(list) => setBody(list)}
                onOpen={(index) => setPath([index])}
              />
            )
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        {!fits && (
          <Typography variant="caption" color="error" sx={{ flexGrow: 1, px: 1 }}>
            {t('templates.tooBig')}
          </Typography>
        )}
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={save} disabled={!name.trim() || !fits}>
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
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

function ListFields({
  list,
  room,
  onChange,
  onOpen,
}: {
  list: TemplateList;
  room: number;
  onChange: (list: TemplateList) => void;
  onOpen: (index: number) => void;
}) {
  return (
    <>
      <TextField
        label={t('list.name')}
        value={list.name}
        onChange={(event) => onChange({ ...list, name: event.target.value })}
      />
      <Part label={t('list.color')}>
        <ColorPicker value={list.color} onChange={(color) => onChange({ ...list, color })} />
      </Part>
      <Part label={t('list.icon')}>
        <IconPicker
          value={list.icon}
          color={list.color}
          onChange={(icon) => onChange({ ...list, icon })}
        />
      </Part>
      <Part label={t('templates.tasks')}>
        <TaskRows
          tasks={list.tasks}
          room={room}
          addLabel={t('task.add')}
          onChange={(tasks) => onChange({ ...list, tasks })}
          onOpen={onOpen}
        />
      </Part>
    </>
  );
}

function TaskFields({
  task,
  room,
  onChange,
  onOpen,
}: {
  task: TemplateTask;
  room: number;
  onChange: (update: (task: TemplateTask) => TemplateTask) => void;
  onOpen: (index: number) => void;
}) {
  const theme = useTheme();
  const today = useToday();
  const workspace = useWorkspace();
  const tags = workspace.entities.tags.filter(isLive);
  const set = (patch: Partial<TemplateTask>) => onChange((was) => ({ ...was, ...patch }));
  const repeats = REPEATS.map(formatRule);
  return (
    <>
      <TextField
        label={t('task.title')}
        value={task.title}
        onChange={(event) => set({ title: event.target.value })}
        slotProps={{ htmlInput: { maxLength: 1000 } }}
      />
      {/* The same notes as a task's details: formatted as typed, with the full editor and its
          toolbar behind the button at the bottom right (PL-149). */}
      <NotesEditor
        title={task.title}
        label={t('task.notes')}
        placeholder={t('task.notesPlaceholder')}
        value={task.notes}
        maxLength={MAX_NOTES_LENGTH}
        onCommit={(notes) => set({ notes })}
      />
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
                        : theme.pecklist.priority[PRIORITY_KEY[priority]].fill
                    } !important`,
                  }}
                />
              }
              label={t(`priority.${priority}`)}
              variant={task.priority === priority ? 'filled' : 'outlined'}
              color={task.priority === priority ? 'primary' : 'default'}
              aria-pressed={task.priority === priority}
              onClick={() => set({ priority })}
            />
          ))}
        </Box>
      </Part>
      <DayField
        label={t('templates.start')}
        value={task.start}
        onChange={(start) =>
          onChange((was) => ({ ...was, start, end: endAfter(was.start, start, was.end) }))
        }
      />
      <DayField label={t('templates.due')} value={task.due} onChange={(due) => set({ due })} />
      <TextField
        select
        label={t('repeat.title')}
        value={task.recurrence ?? ''}
        slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
        onChange={(event) => set({ recurrence: event.target.value || null })}
      >
        <MenuItem value="">{t('repeat.none')}</MenuItem>
        {/* A repeat saved from a task that is not one of these stays on offer. */}
        {task.recurrence && !repeats.includes(task.recurrence) && (
          <MenuItem value={task.recurrence}>{repeatLabel(task.recurrence, today)}</MenuItem>
        )}
        {repeats.map((rule) => (
          <MenuItem key={rule} value={rule}>
            {repeatLabel(rule, today)}
          </MenuItem>
        ))}
      </TextField>
      <Autocomplete
        multiple
        options={tags.map((tag) => tag.id)}
        value={task.tags.filter((id) => tags.some((tag) => tag.id === id))}
        getOptionLabel={(id) => tags.find((tag) => tag.id === id)?.name ?? ''}
        onChange={(_, value) => set({ tags: value })}
        renderInput={(params) => <TextField {...params} label={t('task.tags')} />}
      />
      {task.reminders.length > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
            {t('templates.reminders', { count: task.reminders.length })}
          </Typography>
          <Button size="small" onClick={() => set({ reminders: [], constantReminder: false })}>
            {t('templates.removeReminders')}
          </Button>
        </Box>
      )}
      <Part label={t('task.subtasksHeading')}>
        <TaskRows
          tasks={task.subtasks}
          room={room}
          addLabel={t('task.addSubtask')}
          onChange={(subtasks) => set({ subtasks })}
          onOpen={onOpen}
        />
      </Part>
    </>
  );
}

/** A start's end moves with it, and goes when the start goes or stops matching it. */
function endAfter(
  was: TemplateDate | null,
  start: TemplateDate | null,
  end: TemplateDate | null,
): TemplateDate | null {
  if (!start || !end) return null;
  if ((start.time === null) !== (end.time === null)) return null;
  return { ...end, inDays: end.inDays + (start.inDays - (was?.inDays ?? start.inDays)) };
}

/** A date as days from the day the template is used, with a time or all day. */
function DayField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: TemplateDate | null;
  onChange: (value: TemplateDate | null) => void;
}) {
  if (!value) {
    return (
      <Part label={label}>
        <Button size="small" onClick={() => onChange({ inDays: 0, time: null })}>
          {t('templates.addDate')}
        </Button>
      </Part>
    );
  }
  return (
    <Part label={`${label}: ${relativeDay(value)}`}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <TextField
          size="small"
          type="number"
          label={t('templates.daysFromUse')}
          value={value.inDays}
          onChange={(event) => {
            const days = Math.max(0, Math.min(3650, Math.trunc(Number(event.target.value) || 0)));
            onChange({ ...value, inDays: days });
          }}
          slotProps={{ htmlInput: { min: 0, max: 3650 } }}
          sx={{ width: 130 }}
        />
        <TextField
          size="small"
          type="time"
          label={t('templates.time')}
          value={value.time ?? ''}
          onChange={(event) => onChange({ ...value, time: event.target.value || null })}
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ width: 130 }}
        />
        <Tooltip title={t('templates.removeDate')}>
          <IconButton aria-label={t('templates.removeDate')} onClick={() => onChange(null)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </Part>
  );
}

/** Tasks as rows to rename, open, delete or add to. */
function TaskRows({
  tasks,
  room,
  addLabel,
  onChange,
  onOpen,
}: {
  tasks: TemplateTask[];
  room: number;
  addLabel: string;
  onChange: (tasks: TemplateTask[]) => void;
  onOpen: (index: number) => void;
}) {
  const [adding, setAdding] = useState('');
  return (
    <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {tasks.map((task, index) => (
        <Box
          component="li"
          key={index}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            borderBottom: 1,
            borderColor: 'divider',
            minHeight: 44,
          }}
        >
          <InputBase
            fullWidth
            value={task.title}
            placeholder={t('templates.untitled')}
            inputProps={{ 'aria-label': t('templates.taskTitle', { n: index + 1 }) }}
            onChange={(event) =>
              onChange(
                tasks.map((each, at) =>
                  at === index ? { ...each, title: event.target.value } : each,
                ),
              )
            }
          />
          {task.subtasks.length > 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
              {t('templates.subtaskCount', { count: countTasks(task.subtasks) })}
            </Typography>
          )}
          <Tooltip title={t('templates.openTask')}>
            <IconButton
              size="small"
              aria-label={t('templates.openTaskNamed', {
                name: task.title || t('templates.untitled'),
              })}
              onClick={() => onOpen(index)}
            >
              <ChevronRightIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('common.delete')}>
            <IconButton
              size="small"
              aria-label={t('templates.deleteTask', {
                name: task.title || t('templates.untitled'),
              })}
              onClick={() => onChange(tasks.filter((_, at) => at !== index))}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      ))}
      <Box component="li" sx={{ display: 'flex', alignItems: 'center', minHeight: 44 }}>
        <InputBase
          fullWidth
          value={adding}
          disabled={room <= 0}
          placeholder={room > 0 ? addLabel : t('templates.full', { count: MAX_TEMPLATE_TASKS })}
          inputProps={{ 'aria-label': addLabel }}
          onChange={(event) => setAdding(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            if (!adding.trim() || room <= 0) return;
            onChange([...tasks, blankTask(adding.trim())]);
            setAdding('');
          }}
        />
      </Box>
    </Box>
  );
}
