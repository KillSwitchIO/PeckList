import AddRounded from '@mui/icons-material/AddRounded';
import AccountTreeOutlined from '@mui/icons-material/AccountTreeOutlined';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import LinkOffRounded from '@mui/icons-material/LinkOffRounded';
import RadioButtonUncheckedRounded from '@mui/icons-material/RadioButtonUncheckedRounded';
import {
  Box,
  ButtonBase,
  IconButton,
  InputBase,
  List,
  ListItemButton,
  ListItemText,
  Popover,
  Tooltip,
  Typography,
} from '@mui/material';
import { useState, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { subtaskProgress, subtasksOf, subtaskTree, type SubtaskNode } from '../../core/queries.ts';
import {
  ancestors,
  canIndent,
  createTask,
  deleteTask,
  detachTask,
  indentTask,
  MAX_SUBTASK_DEPTH,
  outdentTask,
  taskDepth,
  updateTask,
} from '../../core/tasks.ts';
import type { Task } from '../../core/types.ts';
import { t } from '../i18n/i18n.ts';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { useLongPress } from '../hooks/useLongPress.ts';
import { DateButton } from './DateButton.tsx';
import { TaskMenu, type TaskMenuAnchor } from './TaskMenu.tsx';
import { PriorityCheckbox } from './TaskRow.tsx';
import { useTaskSelection } from './selection.ts';

const inputId = (id: string) => `subtask-input-${id}`;
const ADD_INPUT = 'subtask-input-new';

function focusInput(id: string) {
  const element = document.getElementById(id);
  if (element instanceof HTMLInputElement) {
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }
}

const chipSx = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 0.75,
  height: 28,
  px: 1,
  border: 1,
  borderColor: 'divider',
  borderRadius: 1.5,
  typography: 'body2',
  color: 'text.secondary',
  '&:hover': { color: 'text.primary', bgcolor: 'action.hover' },
} as const;

function StatusDot({ task }: { task: Task }) {
  return task.status === 'open' ? (
    <RadioButtonUncheckedRounded sx={{ fontSize: 14 }} />
  ) : (
    <CheckCircleRounded sx={{ fontSize: 14 }} />
  );
}

/**
 * The layers above a subtask, Todoist style: a chip per parent (opens it), a switcher listing
 * the parent's subtasks, and "Remove from parent" (makes it a top-level task).
 */
export function ParentTrail({ task }: { task: Task }) {
  const workspace = useWorkspace();
  const apply = useApply();
  const { open } = useTaskSelection();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const chain = ancestors(workspace, task.id);
  const parent = chain[chain.length - 1];
  if (!parent) return null;
  const parentTitle = parent.title || t('task.untitled');
  const siblings = subtasksOf(workspace, parent.id);
  return (
    <Box
      component="nav"
      aria-label={t('task.parents')}
      sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: -0.5 }}
    >
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
        {chain.map((item, index) => (
          <Box key={item.id} sx={{ display: 'inline-flex', alignItems: 'center', minWidth: 0 }}>
            {index > 0 && <ChevronRightRounded sx={{ fontSize: 16, color: 'text.disabled' }} />}
            <ButtonBase onClick={() => open(item.id)} sx={{ ...chipSx, minWidth: 0 }}>
              <StatusDot task={item} />
              <Box
                component="span"
                sx={{
                  maxWidth: '10rem',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.title || t('task.untitled')}
              </Box>
            </ButtonBase>
          </Box>
        ))}
        <ButtonBase
          aria-haspopup="dialog"
          aria-label={t('task.siblingSwitch', { title: parentTitle, count: siblings.length })}
          onClick={(event) => setAnchor(event.currentTarget)}
          sx={chipSx}
        >
          <AccountTreeOutlined sx={{ fontSize: 14 }} />
          {siblings.length}
          <ExpandMoreRounded sx={{ fontSize: 16, ml: -0.5 }} />
        </ButtonBase>
      </Box>
      <Box sx={{ flexGrow: 1 }} />
      <Tooltip title={t('task.detach')}>
        <IconButton
          size="small"
          aria-label={t('task.detach')}
          onClick={() => apply((ctx, ws) => detachTask(ctx, ws, task.id), t('undo.detached'))}
        >
          <LinkOffRounded fontSize="small" />
        </IconButton>
      </Tooltip>
      <Popover
        open={anchor !== null}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{
          paper: {
            role: 'dialog',
            'aria-label': t('task.siblings', { title: parentTitle }),
            sx: { borderRadius: 3, minWidth: 240, maxWidth: 340, py: 1 },
          },
        }}
      >
        <Typography variant="subtitle2" sx={{ px: 2, pb: 0.5 }}>
          {t('task.siblings', { title: parentTitle })}
        </Typography>
        <List dense disablePadding>
          {siblings.map((sibling) => (
            <ListItemButton
              key={sibling.id}
              selected={sibling.id === task.id}
              onClick={() => {
                setAnchor(null);
                open(sibling.id);
              }}
              sx={{ gap: 1.25 }}
            >
              <Box sx={{ display: 'flex', color: 'text.secondary' }}>
                <StatusDot task={sibling} />
              </Box>
              <ListItemText
                primary={sibling.title || t('task.untitled')}
                slotProps={{ primary: { noWrap: true } }}
              />
              {sibling.id === task.id && <CheckRounded fontSize="small" color="primary" />}
            </ListItemButton>
          ))}
        </List>
      </Popover>
    </Box>
  );
}

/** One editable subtask: checkbox, title, and a button to open its own details. */
function SubtaskLine({
  node,
  onKeyDown,
}: {
  node: SubtaskNode;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>, draft: string, commit: () => void) => void;
}) {
  const apply = useApply();
  const { open } = useTaskSelection();
  const { task } = node;
  const [draft, setDraft] = useState(task.title);
  const [synced, setSynced] = useState(task.title);
  // Take outside changes (undo, another tab) without an effect.
  if (task.title !== synced) {
    setSynced(task.title);
    setDraft(task.title);
  }
  const commit = () => {
    const title = draft.trim();
    if (title !== task.title) apply((ctx, ws) => updateTask(ctx, ws, task.id, { title }));
  };
  // A line left blank (Enter, then click away) is not worth keeping.
  const leave = () => {
    if (draft.trim() === '' && task.title === '' && task.deletedAt === null) {
      apply((ctx, ws) => deleteTask(ctx, ws, task.id));
    } else {
      commit();
    }
  };
  const done = task.status !== 'open';
  const title = task.title || t('task.untitled');
  const [menu, setMenu] = useState<TaskMenuAnchor | null>(null);
  const longPress = useLongPress((position) => setMenu({ position }));
  return (
    <Box
      onContextMenu={(event) => {
        event.preventDefault();
        setMenu({ position: { top: event.clientY, left: event.clientX } });
      }}
      {...longPress}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        pl: `${node.depth * 24}px`,
        borderRadius: 1.5,
        '&:hover .subtask-open, &:focus-within .subtask-open': { opacity: 1 },
      }}
    >
      <PriorityCheckbox task={task} />
      <InputBase
        fullWidth
        value={draft}
        placeholder={t('task.untitled')}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={leave}
        onKeyDown={(event) => onKeyDown(event as KeyboardEvent<HTMLInputElement>, draft, commit)}
        inputProps={{ id: inputId(task.id), 'aria-label': t('task.subtaskTitle') }}
        sx={{ color: done ? 'text.disabled' : 'text.primary', typography: 'body1' }}
      />
      {/* Like the list rows: the start date (or the completion day) on the right. */}
      <DateButton task={task} width="auto" testId="subtask-date" />
      <IconButton
        className="subtask-open"
        size="small"
        aria-label={t('task.open', { title })}
        onClick={() => open(task.id)}
        sx={{ opacity: { xs: 1, md: 0 }, transition: 'opacity 120ms' }}
      >
        <ChevronRightRounded fontSize="small" />
      </IconButton>
      <TaskMenu task={task} anchor={menu} onClose={() => setMenu(null)} showOpen />
    </Box>
  );
}

/**
 * The task's subtasks as an editable checklist. Keyboard: Enter adds the next subtask, Tab and
 * Shift+Tab indent and outdent, Backspace on an empty line deletes it, arrows move between lines.
 */
export function SubtaskEditor({ task }: { task: Task }) {
  const workspace = useWorkspace();
  const apply = useApply();
  const [draft, setDraft] = useState('');
  const nodes = subtaskTree(workspace, task.id);
  const progress = subtaskProgress(workspace, task.id);
  // Direct subtasks of a task at the deepest level cannot exist.
  const canHaveSubtasks = taskDepth(workspace, task.id) < MAX_SUBTASK_DEPTH;
  if (!canHaveSubtasks && nodes.length === 0) return null;

  // Run a change and render it now, so focus can move to rows that just appeared.
  const applyNow = (operation: Parameters<typeof apply>[0], label?: string) =>
    flushSync(() => apply(operation, label));

  const add = () => {
    const title = draft.trim();
    if (!title) return;
    applyNow(
      (ctx, ws) => createTask(ctx, ws, { title, listId: task.listId, parentId: task.id }).workspace,
    );
    setDraft('');
  };

  const lineKeys = (
    index: number,
    event: KeyboardEvent<HTMLInputElement>,
    lineDraft: string,
    commit: () => void,
  ) => {
    const node = nodes[index]!;
    const id = node.task.id;
    if (event.key === 'Enter' && lineDraft.trim() === '') {
      // Enter on a blank line ends the run: drop it and go to "Add subtask".
      event.preventDefault();
      applyNow((ctx, ws) => deleteTask(ctx, ws, id));
      focusInput(ADD_INPUT);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      commit();
      let created = '';
      applyNow((ctx, ws) => {
        const result = createTask(ctx, ws, {
          title: '',
          listId: task.listId,
          parentId: node.task.parentId,
          afterId: id,
        });
        created = result.task.id;
        return result.workspace;
      });
      focusInput(inputId(created));
    } else if (event.key === 'Tab' && !event.shiftKey && canIndent(workspace, id)) {
      event.preventDefault();
      commit();
      applyNow((ctx, ws) => indentTask(ctx, ws, id));
      focusInput(inputId(id));
    } else if (event.key === 'Tab' && event.shiftKey && node.task.parentId !== task.id) {
      // Outdenting a direct subtask would move it out of this task: only deeper lines move.
      event.preventDefault();
      commit();
      applyNow((ctx, ws) => outdentTask(ctx, ws, id));
      focusInput(inputId(id));
    } else if (event.key === 'Backspace' && lineDraft === '') {
      event.preventDefault();
      const previous = nodes[index - 1];
      applyNow((ctx, ws) => deleteTask(ctx, ws, id), t('undo.subtaskDeleted'));
      focusInput(previous ? inputId(previous.task.id) : ADD_INPUT);
    } else if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault();
      focusInput(inputId(nodes[index - 1]!.task.id));
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = nodes[index + 1];
      focusInput(next ? inputId(next.task.id) : ADD_INPUT);
    }
  };

  return (
    <Box component="section" aria-label={t('task.subtasksHeading')}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5, px: 1 }}>
        <Typography variant="subtitle2" component="h2">
          {t('task.subtasksHeading')}
        </Typography>
        {progress.total > 0 && (
          <Typography variant="body2" color="text.secondary">
            {t('task.subtasks', { done: progress.done, total: progress.total })}
          </Typography>
        )}
      </Box>
      {nodes.map((node, index) => (
        <SubtaskLine
          key={node.task.id}
          node={node}
          onKeyDown={(event, lineDraft, commit) => lineKeys(index, event, lineDraft, commit)}
        />
      ))}
      {canHaveSubtasks && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
          <Box sx={{ width: 34, display: 'grid', placeItems: 'center' }}>
            <AddRounded fontSize="small" />
          </Box>
          <InputBase
            fullWidth
            value={draft}
            placeholder={t('task.addSubtask')}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                add();
              } else if (event.key === 'ArrowUp' && nodes.length > 0) {
                event.preventDefault();
                focusInput(inputId(nodes[nodes.length - 1]!.task.id));
              }
            }}
            inputProps={{ id: ADD_INPUT, 'aria-label': t('task.addSubtask') }}
            sx={{ color: 'text.primary' }}
          />
        </Box>
      )}
    </Box>
  );
}
