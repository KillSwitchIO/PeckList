import AddRounded from '@mui/icons-material/AddRounded';
import {
  Box,
  Button,
  ButtonBase,
  IconButton,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { localTimeZone } from '../../core/dates.ts';
import { findInbox } from '../../core/lists.ts';
import { buildPalette } from '../../core/palette.ts';
import { moveInOrder } from '../../core/sidebar.ts';
import {
  blankList,
  blankTask,
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  listBody,
  moveTemplate,
  renameTemplate,
  templatesOf,
  fromListTemplate,
  fromTaskTemplate,
} from '../../core/templates.ts';
import type { Template } from '../../core/types.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { MoreIcon } from '../icons/icons.tsx';
import { Page } from '../layout/Page.tsx';
import { SortHandle } from '../layout/SortHandle.tsx';
import { useSortableRows } from '../layout/useSortableRows.ts';
import { ConfirmDialog, NameDialog } from '../lists/ListDialog.tsx';
import { openingMade } from '../tasks/detailFocus.ts';
import { Section } from '../settings/settingsLayout.tsx';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { useTaskSelection } from '../tasks/selection.ts';
import { TemplateEditor } from './TemplateEditor.tsx';
import { templateSummary } from './templateSummary.ts';

const LIGHT = buildPalette('light');

type Dialog =
  | { kind: 'new'; templateKind: Template['kind'] }
  | { kind: 'edit'; id: string }
  | { kind: 'rename'; template: Template }
  | { kind: 'delete'; template: Template }
  | { kind: 'useList'; template: Template };

/**
 * Templates (PL-140): a page of its own in the menu, like a list's. Task templates and list
 * templates in two groups; drag to reorder, and from a row's menu use, edit, rename, duplicate or
 * delete it. Templates are made with Save as template in a task's or list's menu, or New here.
 */
export function TemplatesPage() {
  const workspace = useWorkspace();
  const apply = useApply();
  const navigate = useNavigate();
  const today = useToday();
  const { open } = useTaskSelection();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [adding, setAdding] = useState<HTMLElement | null>(null);
  const close = () => setDialog(null);
  const editing =
    dialog?.kind === 'edit'
      ? workspace.entities.templates.find((each) => each.id === dialog.id)
      : undefined;

  const use = (template: Template) => {
    if (template.kind === 'list') {
      setDialog({ kind: 'useList', template });
      return;
    }
    const inbox = findInbox(workspace);
    if (!inbox) return;
    let id: string | null = null;
    apply((ctx, ws) => {
      const made = fromTaskTemplate(
        ctx,
        ws,
        template.id,
        { listId: inbox.id },
        { day: today, timeZone: localTimeZone() },
      );
      id = made.taskId;
      return made.workspace;
    }, t('undo.templateUsed'));
    if (id) {
      openingMade(id);
      open(id, { full: true });
    }
  };

  const actions = {
    use,
    edit: (template: Template) => setDialog({ kind: 'edit', id: template.id }),
    rename: (template: Template) => setDialog({ kind: 'rename', template }),
    duplicate: (template: Template) =>
      apply(
        (ctx, ws) =>
          duplicateTemplate(ctx, ws, template.id, t('templates.copyName', { name: template.name }))
            .workspace,
      ),
    delete: (template: Template) => setDialog({ kind: 'delete', template }),
  };

  return (
    <Page
      title={t('nav.templates')}
      actions={
        <Tooltip title={t('templates.new')}>
          <IconButton
            aria-label={t('templates.new')}
            onClick={(event) => setAdding(event.currentTarget)}
          >
            <AddRounded />
          </IconButton>
        </Tooltip>
      }
    >
      <Menu anchorEl={adding} open={adding !== null} onClose={() => setAdding(null)}>
        <MenuItem
          onClick={() => {
            setAdding(null);
            setDialog({ kind: 'new', templateKind: 'task' });
          }}
        >
          {t('templates.newTask')}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAdding(null);
            setDialog({ kind: 'new', templateKind: 'list' });
          }}
        >
          {t('templates.newList')}
        </MenuItem>
      </Menu>
      <Stack spacing={4}>
        <TemplateGroup kind="task" today={today} actions={actions} />
        <TemplateGroup kind="list" today={today} actions={actions} />
      </Stack>

      {dialog?.kind === 'new' && (
        <NameDialog
          open
          title={dialog.templateKind === 'task' ? t('templates.newTask') : t('templates.newList')}
          label={t('templates.name')}
          submitLabel={t('common.create')}
          onClose={close}
          onSubmit={(name) => {
            let id: string | null = null;
            apply((ctx, ws) => {
              const made =
                dialog.templateKind === 'task'
                  ? createTemplate(ctx, ws, { name, kind: 'task', body: blankTask(name) })
                  : createTemplate(ctx, ws, {
                      name,
                      kind: 'list',
                      body: blankList(name, LIGHT.pastels.sky.fill),
                    });
              id = made.template.id;
              return made.workspace;
            });
            // A new template starts empty: straight on to filling it in.
            setDialog(id ? { kind: 'edit', id } : null);
          }}
        />
      )}
      {editing && <TemplateEditor template={editing} onClose={close} />}
      {dialog?.kind === 'rename' && (
        <NameDialog
          open
          title={t('templates.rename')}
          label={t('templates.name')}
          initial={dialog.template.name}
          submitLabel={t('common.save')}
          onClose={close}
          onSubmit={(name) => {
            apply((ctx, ws) => renameTemplate(ctx, ws, dialog.template.id, name));
            close();
          }}
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          open
          message={t('templates.deleteConfirm', { name: dialog.template.name })}
          confirmLabel={t('common.delete')}
          onClose={close}
          onConfirm={() => {
            close();
            apply(
              (ctx, ws) => deleteTemplate(ctx, ws, dialog.template.id),
              t('undo.templateDeleted'),
            );
          }}
        />
      )}
      {dialog?.kind === 'useList' && (
        <NameDialog
          open
          title={t('templates.useList')}
          label={t('list.name')}
          initial={listBody(dialog.template)?.name ?? dialog.template.name}
          submitLabel={t('common.create')}
          onClose={close}
          onSubmit={(name) => {
            let listId: string | null = null;
            apply((ctx, ws) => {
              const made = fromListTemplate(ctx, ws, dialog.template.id, name, {
                day: today,
                timeZone: localTimeZone(),
              });
              listId = made.listId;
              return made.workspace;
            }, t('undo.templateUsed'));
            close();
            if (listId) void navigate(`/lists/${listId}`);
          }}
        />
      )}
    </Page>
  );
}

type Actions = Record<
  'use' | 'edit' | 'rename' | 'duplicate' | 'delete',
  (template: Template) => void
>;

function TemplateGroup({
  kind,
  today,
  actions,
}: {
  kind: Template['kind'];
  today: string;
  actions: Actions;
}) {
  const workspace = useWorkspace();
  const apply = useApply();
  const templates = templatesOf(workspace, kind);
  const [order, setOrder] = useState<string[] | null>(null);
  const latest = useRef<string[] | null>(null);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; template: Template } | null>(null);
  const base = () => templates.map((template) => template.id);
  const sortable = useSortableRows({
    editing: true,
    start: () => {},
    onDrag: (id, y) => {
      const from = latest.current ?? base();
      const next = moveInOrder(
        from,
        id,
        sortable.slot(
          from.filter((each) => each !== id),
          y,
        ),
      );
      if (next.join() === from.join()) return;
      latest.current = next;
      setOrder(next);
    },
    onDrop: (id) => {
      const next = latest.current;
      if (next && next.join() !== base().join()) {
        const at = next.indexOf(id);
        apply((ctx, ws) => moveTemplate(ctx, ws, id, at > 0 ? next[at - 1]! : null));
      }
      latest.current = null;
      setOrder(null);
    },
  });
  const byId = new Map(templates.map((template) => [template.id, template]));
  const ids = order ?? base();
  const groupLabel = kind === 'task' ? t('templates.taskGroup') : t('templates.listGroup');

  return (
    <Section title={groupLabel}>
      <Box component="ul" aria-label={groupLabel} sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {ids.map((id) => {
          const template = byId.get(id);
          if (!template) return null;
          return (
            <Box
              component="li"
              key={id}
              {...sortable.rowProps(id)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                minHeight: 52,
                pl: 2.5,
                pr: 0.5,
                borderBottom: 1,
                borderColor: 'divider',
                position: 'relative',
                bgcolor: sortable.dragging === id ? 'action.selected' : 'transparent',
                boxShadow: sortable.dragging === id ? 4 : 0,
                zIndex: sortable.dragging === id ? 1 : 0,
              }}
            >
              <SortHandle />
              <ButtonBase
                onClick={() => actions.edit(template)}
                aria-label={t('templates.editNamed', { name: template.name })}
                sx={{
                  flexGrow: 1,
                  minWidth: 0,
                  display: 'block',
                  textAlign: 'left',
                  py: 0.75,
                  px: 0.5,
                  borderRadius: 1,
                }}
              >
                <Typography noWrap>{template.name}</Typography>
                <Typography noWrap variant="caption" color="text.secondary" component="div">
                  {templateSummary(template, today)}
                </Typography>
              </ButtonBase>
              <Button size="small" onClick={() => actions.use(template)} sx={{ flexShrink: 0 }}>
                {t('templates.use')}
              </Button>
              <IconButton
                aria-label={t('templates.menu', { name: template.name })}
                onClick={(event) => setMenu({ anchor: event.currentTarget, template })}
              >
                <MoreIcon fontSize="small" />
              </IconButton>
            </Box>
          );
        })}
      </Box>
      {templates.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 1 }}>
          {kind === 'task' ? t('templates.emptyTasks') : t('templates.emptyLists')}
        </Typography>
      )}
      <Menu anchorEl={menu?.anchor} open={menu !== null} onClose={() => setMenu(null)}>
        {(['edit', 'rename', 'duplicate', 'delete'] as const).map((action) => (
          <MenuItem
            key={action}
            onClick={() => {
              const template = menu!.template;
              setMenu(null);
              actions[action](template);
            }}
          >
            <ListItemText slotProps={action === 'delete' ? { primary: { color: 'error' } } : {}}>
              {t(`templates.action.${action}`)}
            </ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </Section>
  );
}
