import AddRounded from '@mui/icons-material/AddRounded';
import { Box, InputBase } from '@mui/material';
import { useState } from 'react';
import { createTask, type TaskInput } from '../../core/tasks.ts';
import { t } from '../i18n/i18n.ts';
import { useApply } from '../store/hooks.ts';

/** Soft, filled task entry bar. Natural-language parsing arrives with quick add (PL-022). */
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
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1.5,
        py: 0.75,
        mb: 1,
        borderRadius: 2,
        bgcolor: 'action.hover',
        color: 'text.secondary',
        '&:focus-within': { bgcolor: 'action.selected' },
      }}
    >
      <AddRounded fontSize="small" />
      <InputBase
        fullWidth
        placeholder={label}
        value={title}
        autoFocus={autoFocus}
        onChange={(event) => setTitle(event.target.value)}
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
        sx={{ color: 'text.primary' }}
      />
    </Box>
  );
}
