import AddRounded from '@mui/icons-material/AddRounded';
import { InputAdornment, TextField } from '@mui/material';
import { useState } from 'react';
import { createTask, type TaskInput } from '../../core/tasks.ts';
import { t } from '../i18n/i18n.ts';
import { useApply } from '../store/hooks.ts';

/** Single-line task entry. Natural-language parsing arrives with quick add (PL-022). */
export function AddTaskInput({
  defaults,
  label = t('task.add'),
  autoFocus = false,
}: {
  defaults: Omit<TaskInput, 'title'>;
  label?: string;
  autoFocus?: boolean;
}) {
  const apply = useApply();
  const [title, setTitle] = useState('');

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    apply((ctx, ws) => createTask(ctx, ws, { ...defaults, title: trimmed }).workspace);
    setTitle('');
  };

  return (
    <TextField
      fullWidth
      size="small"
      placeholder={label}
      value={title}
      autoFocus={autoFocus}
      onChange={(event) => setTitle(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          submit();
        }
      }}
      slotProps={{
        htmlInput: { 'aria-label': label },
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <AddRounded fontSize="small" />
            </InputAdornment>
          ),
        },
      }}
      sx={{ mb: 1 }}
    />
  );
}
