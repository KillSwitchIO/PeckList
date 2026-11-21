import RepeatRounded from '@mui/icons-material/RepeatRounded';
import OpenInFullRounded from '@mui/icons-material/OpenInFullRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import { Box, Chip, IconButton, InputBase, Tooltip } from '@mui/material';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { datePart, localTimeZone, wallClock } from '../../core/dates.ts';
import {
  createFromQuickAdd,
  parseQuickAdd,
  type QuickAdd,
  type Token,
} from '../../core/quickAdd.ts';
import { findInbox } from '../../core/lists.ts';
import { withNewTaskDefaults } from '../../core/newTaskDefaults.ts';
import { assigneeCandidates } from '../../core/sharing.ts';
import { createTask, type TaskInput } from '../../core/tasks.ts';
import { templatesOf, fromTaskTemplate } from '../../core/templates.ts';
import type { Task, Template, WorkspaceFile } from '../../core/types.ts';
import type { DateParser, ParsedMoment } from '../../ports/dateParser.ts';
import { formatSpan, formatWhen } from '../format.ts';
import { useToday } from '../hooks/useToday.ts';
import { currentLanguage, t } from '../i18n/i18n.ts';
import { repeatLabel } from '../repeat/repeatText.ts';
import {
  AssignedIcon,
  CalendarIcon,
  CloseIcon,
  DueIcon,
  FlagIcon,
  TemplateIcon,
} from '../icons/icons.tsx';
import { listName } from '../lists/listName.ts';
import { TemplatePicker } from '../templates/TemplatePicker.tsx';
import { useApply, useStoreState, useWorkspace } from '../store/hooks.ts';
import { newTaskAssignees } from './newTaskAssignees.ts';
import { useTaskSelection } from './selection.ts';
import { markDraft } from './drafts.ts';
import { openingMade } from './detailFocus.ts';
import { ADD_TEXT_EVENT } from './focusAddTask.ts';
import { loadQuickAddParser } from './quickAddParser.ts';
import { useSyncState } from '../sync/syncContext.ts';
import { countUse } from '../telemetry/usage.ts';

const asValue = (moment: ParsedMoment) =>
  moment.time ? `${moment.date}T${moment.time}` : moment.date;

/** What a chip says and shows for one recognised piece of the text. */
function chipFor(
  token: Token,
  parsed: QuickAdd,
  today: string,
  names: { list: (id: string) => string; person: (text: string) => string },
): { label: string; icon?: ReactElement } {
  switch (token.kind) {
    case 'date': {
      const { start, end } = parsed.schedule!;
      return {
        label: end
          ? formatSpan(asValue(start), asValue(end), today)
          : formatWhen(asValue(start), today),
        icon: <CalendarIcon />,
      };
    }
    case 'due':
      return {
        label: t('quickAdd.due', { date: formatWhen(asValue(parsed.due!), today) }),
        icon: <DueIcon />,
      };
    case 'priority':
      return {
        label: t(`priority.${parsed.priority ?? 0}`),
        icon: <FlagIcon filled={parsed.priority !== 0} />,
      };
    case 'list':
      return { label: names.list(parsed.listId!) };
    case 'tag':
      return { label: token.text };
    case 'person':
      return { label: names.person(token.text), icon: <AssignedIcon /> };
    case 'repeat':
      return {
        label: repeatLabel(parsed.recurrence, today),
        icon: <RepeatRounded sx={{ fontSize: 16 }} />,
      };
  }
}

/** The add bar of a view that adds to the Inbox; none before the first sync brings the Inbox. */
export function AddToInbox() {
  const inbox = findInbox(useWorkspace());
  return inbox ? <AddTaskInput defaults={{ listId: inbox.id }} /> : null;
}

/**
 * Soft, filled task entry bar with quick add (PL-022): type "Call mom tomorrow 3pm #family
 * !high" and chips show what will be set before Enter saves it. A chip's x keeps those words
 * in the title instead.
 */
export function AddTaskInput({
  defaults,
  label = t('task.add'),
  autoFocus = false,
  inList = false,
}: {
  defaults: Omit<TaskInput, 'title'>;
  label?: string;
  autoFocus?: boolean;
  /** The list in `defaults` is the page's own (a list page): the default list does not apply. */
  inList?: boolean;
}) {
  const apply = useApply();
  const workspace = useWorkspace();
  const today = useToday();
  const me = useStoreState((state) => state.context().userId);
  const phase = useSyncState((state) => state.phase);
  const authMode = useSyncState((state) => state.account?.authMode);
  const [title, setTitle] = useState('');
  // Quick add reads its words and dates in the app's language as well as English (PL-148).
  const language = currentLanguage();
  const [reader, setReader] = useState<{ language: string; parser: DateParser } | null>(null);
  const readWords = () => {
    const wanted = currentLanguage();
    // Not fetched (no network, no service worker): the words stay as typed, and the next focus
    // tries again.
    loadQuickAddParser(wanted).then(
      (parser) => setReader({ language: wanted, parser }),
      () => undefined,
    );
  };
  // A language picked while the field is in use: its parser takes over.
  useEffect(() => {
    if (reader && reader.language !== language) readWords();
  });
  const parser = reader?.language === language ? reader.parser : null;
  const [ignore, setIgnore] = useState<ReadonlySet<string>>(new Set());
  const [picking, setPicking] = useState<HTMLElement | null>(null);
  const field = useRef<HTMLTextAreaElement | null>(null);
  // A title from outside the app (shared, selected or spoken: fillAddTask), one line, to check and add.
  useEffect(() => {
    const input = field.current;
    if (!input) return;
    const take = (event: Event) => {
      const text = (event as CustomEvent<unknown>).detail;
      if (typeof text !== 'string') return;
      const line = text.replace(/\s+/g, ' ').trim();
      if (!line) return;
      // Words being typed stay: any app can send text at any time, so it goes after them.
      setTitle((typed) => (typed.trim() ? `${typed.trimEnd()} ${line}` : line));
      setIgnore(new Set());
      readWords();
    };
    input.addEventListener(ADD_TEXT_EVENT, take);
    return () => input.removeEventListener(ADD_TEXT_EVENT, take);
  }, []);

  // @ names the people the assignee picker offers (servers with accounts only).
  const people =
    phase === 'ready' && authMode === 'local'
      ? assigneeCandidates(workspace, me, { listId: defaults.listId, assignees: {} } as Task)
      : [];
  const parsed =
    parser && title.trim()
      ? parseQuickAdd(title, {
          workspace,
          parser,
          reference: wallClock(localTimeZone(), new Date()),
          people,
          ignore,
          language,
        })
      : null;
  const quick = parsed !== null && parsed.tokens.length > 0 && parsed.title !== '';

  // Settings > New tasks fill what the place says nothing about; quick add's words win over both.
  const placed = (ws: WorkspaceFile) =>
    withNewTaskDefaults(ws, defaults, { today, timeZone: localTimeZone(), inList });

  /** Make the task from what is typed; returns its id. `blank` allows an empty title. */
  const make = (blank = false): string | null => {
    const trimmed = title.trim();
    if (!trimmed && !blank) return null;
    let id: string | null = null;
    const accounts = phase === 'ready' && authMode === 'local';
    const withAssignee = (ws: WorkspaceFile, base: Omit<TaskInput, 'title'>, listId: string) => ({
      ...base,
      assignees: base.assignees ?? newTaskAssignees(ws, listId, me, accounts),
    });
    if (quick) {
      apply((ctx, ws) => {
        const base = placed(ws);
        const made = createFromQuickAdd(
          ctx,
          ws,
          parsed,
          withAssignee(ws, base, parsed.listId ?? base.listId),
          localTimeZone(),
        );
        id = made.id;
        return made.workspace;
      });
    } else {
      apply((ctx, ws) => {
        const base = placed(ws);
        const made = createTask(ctx, ws, {
          ...withAssignee(ws, base, base.listId),
          title: trimmed,
        });
        id = made.task.id;
        return made.workspace;
      });
    }
    setTitle('');
    setIgnore(new Set());
    countUse('task.added');
    if (quick && parsed) {
      if (parsed.schedule || parsed.due) countUse('quickAdd.date');
      if (parsed.tags.length > 0) countUse('quickAdd.tag');
      if (parsed.listId) countUse('quickAdd.list');
      if (parsed.priority !== null) countUse('quickAdd.priority');
    }
    return id;
  };
  const submit = () => void make();
  const { open } = useTaskSelection();
  // The full task form: what is typed so far becomes the task, opened full screen.
  const expand = () => {
    const id = make(true);
    if (!id) return;
    if (title.trim() === '') markDraft(id);
    open(id, { full: true });
  };

  // A task template (PL-140): made in this place's list, its dates counted from the place's day
  // (the calendar's) or today; the words typed so far become its title. Opened full screen.
  const hasTemplates = templatesOf(workspace, 'task').length > 0;
  const fromTemplate = (template: Template) => {
    setPicking(null);
    let id: string | null = null;
    apply((ctx, ws) => {
      const base = placed(ws);
      const accounts = phase === 'ready' && authMode === 'local';
      const made = fromTaskTemplate(
        ctx,
        ws,
        template.id,
        {
          listId: base.listId,
          parentId: base.parentId ?? null,
          // The words typed, less what quick add read from them ("tomorrow 9am"): the template
          // has its own dates.
          title: quick ? parsed.title : title.trim(),
          schedule: base.schedule ?? null,
          assignees: base.assignees ?? newTaskAssignees(ws, base.listId, me, accounts),
        },
        {
          day: base.schedule ? datePart(base.schedule.start) : today,
          timeZone: localTimeZone(),
        },
      );
      id = made.taskId;
      return made.workspace;
    }, t('undo.templateUsed'));
    setTitle('');
    setIgnore(new Set());
    if (id) {
      openingMade(id);
      open(id, { full: true });
    }
  };

  const names = {
    list: (id: string) => {
      const list = workspace.entities.lists.find((each) => each.id === id);
      return list ? listName(list, workspace) : '';
    },
    person: (text: string) => {
      const wanted = text.slice(1).toLowerCase();
      const found = people.find(
        (each) =>
          each.name.toLowerCase() === wanted ||
          each.user?.handle.toLowerCase().split('@')[0] === wanted,
      );
      return found?.name ?? text;
    },
  };

  return (
    <Box sx={{ mb: 1 }}>
      <Box
        sx={{
          px: 1.5,
          py: 0.75,
          borderRadius: 2,
          bgcolor: 'action.hover',
          color: 'text.secondary',
          '&:focus-within': { bgcolor: 'action.selected' },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
          <AddRounded fontSize="small" sx={{ mt: 0.25 }} />
          {/* Wraps and grows with the text, so a long line stays easy to read and fix. */}
          <InputBase
            fullWidth
            multiline
            placeholder={label}
            value={title}
            autoFocus={autoFocus}
            onFocus={readWords}
            // A title is one line: a pasted line break becomes a space.
            onChange={(event) => setTitle(event.target.value.replace(/\s*[\r\n]+\s*/g, ' '))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submit();
              } else if (event.key === 'Escape' && title === '') {
                // Leave the field, so the keyboard shortcuts work again.
                event.currentTarget.blur();
              }
            }}
            // Q (keyboard shortcuts) focuses the first one on the page.
            inputProps={{ 'aria-label': label, 'data-add-task': '' }}
            inputRef={field}
            sx={{ color: 'text.primary', p: 0 }}
          />
          <Tooltip title={t('quickAdd.expand')}>
            <IconButton
              size="small"
              aria-label={t('quickAdd.expand')}
              onClick={expand}
              // The + button opens this (R-FB-74).
              data-add-task-expand=""
              sx={{ color: 'text.secondary', flexShrink: 0, my: -0.25 }}
            >
              <OpenInFullRounded sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          {hasTemplates && (
            <Tooltip title={t('templates.fromTemplate')}>
              <IconButton
                size="small"
                aria-label={t('templates.fromTemplate')}
                aria-haspopup="dialog"
                onClick={(event) => setPicking(event.currentTarget)}
                sx={{ color: 'text.secondary', flexShrink: 0, my: -0.25, ml: -0.75 }}
              >
                <TemplateIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
        {picking && (
          <TemplatePicker
            kind="task"
            anchor={picking}
            onClose={() => setPicking(null)}
            onPick={fromTemplate}
          />
        )}
        {quick && (
          <Box
            role="list"
            aria-label={t('quickAdd.recognised')}
            // On their own line under the text, wrapping as needed, each easy to take off.
            sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.75, pl: 3.5 }}
          >
            {parsed.tokens.map((token) => {
              const chip = chipFor(token, parsed, today, names);
              return (
                <Chip
                  key={`${token.kind}:${token.start}`}
                  role="listitem"
                  size="small"
                  variant="outlined"
                  color="primary"
                  label={chip.label}
                  {...(chip.icon ? { icon: chip.icon } : {})}
                  onDelete={() => setIgnore(new Set([...ignore, token.text]))}
                  deleteIcon={
                    <CloseIcon aria-label={t('quickAdd.keepAsText', { text: token.text })} />
                  }
                  sx={{ maxWidth: '100%' }}
                />
              );
            })}
          </Box>
        )}
      </Box>
    </Box>
  );
}
