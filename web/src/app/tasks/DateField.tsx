import { Box, Chip, TextField } from '@mui/material';
import { addDays } from '../../core/dates.ts';
import { t } from '../i18n/i18n.ts';

/**
 * A date input that opens the picker on any click (not just the calendar icon), with one-click
 * shortcuts for the common choices.
 */
export function DateField({
  label,
  value,
  today,
  onChange,
}: {
  label: string;
  /** `YYYY-MM-DD` or '' */
  value: string;
  today: string;
  onChange: (value: string | null) => void;
}) {
  const choices = [
    { label: t('date.today'), date: today },
    { label: t('date.tomorrow'), date: addDays(today, 1) },
    { label: t('date.nextWeek'), date: addDays(today, 7) },
  ];

  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <TextField
        label={label}
        type="date"
        value={value}
        fullWidth
        slotProps={{ inputLabel: { shrink: true } }}
        onClick={(event) => {
          const input = (event.currentTarget as HTMLElement).querySelector('input');
          try {
            input?.showPicker();
          } catch {
            // showPicker is unavailable or blocked (older browser); typing still works.
          }
        }}
        onChange={(event) => onChange(event.target.value || null)}
      />
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.75 }}>
        {choices.map((choice) => (
          <Chip
            key={choice.label}
            size="small"
            label={choice.label}
            aria-label={t('date.quickSet', { field: label, choice: choice.label })}
            color={value === choice.date ? 'primary' : 'default'}
            variant={value === choice.date ? 'filled' : 'outlined'}
            onClick={() => onChange(choice.date)}
          />
        ))}
        {value && (
          <Chip
            size="small"
            variant="outlined"
            label={t('date.clear')}
            aria-label={t('date.quickSet', { field: label, choice: t('date.clear') })}
            onClick={() => onChange(null)}
          />
        )}
      </Box>
    </Box>
  );
}
