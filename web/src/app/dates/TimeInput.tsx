import { TextField } from '@mui/material';
import { useState } from 'react';
import { parseTime } from '../../core/time.ts';
import { formatTime } from '../format.ts';
import { t } from '../i18n/i18n.ts';

/**
 * Typed time entry that accepts 9, 0930, 9:30, 22:00 or 10pm. Missing minutes become 00.
 * Shows a live preview of how the entry reads and commits a 24-hour `HH:mm` on Enter or blur.
 */
export function TimeInput({
  value,
  onChange,
  autoFocus = false,
}: {
  /** `HH:mm` or null */
  value: string | null;
  onChange: (time: string | null) => void;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(value ? formatTime(value) : '');
  const parsed = parseTime(text);
  const invalid = text.trim() !== '' && parsed === null;

  const commit = () => {
    if (text.trim() === '') {
      onChange(null);
    } else if (parsed) {
      onChange(parsed);
      setText(formatTime(parsed));
    }
  };

  return (
    <TextField
      size="small"
      fullWidth
      value={text}
      autoFocus={autoFocus}
      placeholder={t('time.placeholder')}
      error={invalid}
      helperText={
        invalid
          ? t('time.invalid')
          : parsed && text !== formatTime(parsed)
            ? formatTime(parsed)
            : ' '
      }
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
      }}
      slotProps={{
        htmlInput: { 'aria-label': t('date.time'), inputMode: 'text', autoComplete: 'off' },
        formHelperText: { sx: { mx: 0 } },
      }}
    />
  );
}
