import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import {
  createTemplate,
  MAX_TEMPLATE_NAME,
  templateFits,
  templateOfList,
  templateOfTask,
} from '../../core/templates.ts';
import { submitOnShiftEnter } from '../hooks/keys.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { useApply, useWorkspace } from '../store/hooks.ts';

/**
 * Save as template (PL-140), from a task's or a list's menu: it asks only for a name, the title
 * to start with. What it keeps is the task or list as it is now (core/templates.ts).
 */
export function SaveTemplateDialog({
  source,
  name,
  onClose,
}: {
  source: { kind: 'task'; taskId: string } | { kind: 'list'; listId: string };
  name: string;
  onClose: () => void;
}) {
  const apply = useApply();
  const workspace = useWorkspace();
  const today = useToday();
  const [value, setValue] = useState(name);
  // Worked out once, when the dialog opens: what the template will hold.
  const [saved] = useState(() =>
    source.kind === 'task'
      ? { kind: 'task' as const, body: templateOfTask(workspace, source.taskId, today) }
      : { kind: 'list' as const, body: templateOfList(workspace, source.listId, today) },
  );
  const fits = templateFits(saved.body);
  const valid = value.trim().length > 0 && fits;
  const save = () => {
    if (!valid) return;
    apply(
      (ctx, ws) => createTemplate(ctx, ws, { name: value, ...saved }).workspace,
      t('undo.templateSaved'),
    );
    onClose();
  };
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <form
        onKeyDown={submitOnShiftEnter}
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <DialogTitle>{t('templates.saveAs')}</DialogTitle>
        <DialogContent>
          <TextField
            label={t('templates.name')}
            value={value}
            autoFocus
            fullWidth
            sx={{ mt: 1 }}
            slotProps={{ htmlInput: { maxLength: MAX_TEMPLATE_NAME } }}
            onFocus={(event) => event.target.select()}
            onChange={(event) => setValue(event.target.value)}
          />
          {!fits && (
            <Typography variant="body2" color="error" sx={{ mt: 1.5 }}>
              {t('templates.tooBig')}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="contained" disabled={!valid}>
            {t('common.save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
