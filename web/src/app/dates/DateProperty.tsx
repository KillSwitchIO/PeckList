import { Box, Typography } from '@mui/material';
import { datePart, timePart } from '../../core/dates.ts';
import { useState, type ReactNode } from 'react';
import { formatDay, formatSpan, formatTime, formatWhen } from '../format.ts';
import { PropertyRow, PropertySheet } from '../tasks/PropertyRow.tsx';
import { t } from '../i18n/i18n.ts';
import { DatePickerPanel } from './DatePickerPanel.tsx';
import { fromDateValue, type DateValue } from './dateValue.ts';

/** A task property row ("icon  Label ........ value") that opens the date picker. */
export function DateProperty({
  label,
  icon,
  value,
  today,
  placeholder,
  valueColor,
  allowRange = false,
  compact = false,
  inline = false,
  onChange,
}: {
  label: string;
  icon: ReactNode;
  value: DateValue | null;
  today: string;
  placeholder: string;
  valueColor?: string;
  /** Offer Duration (a start and an end) next to a single date */
  allowRange?: boolean;
  /** Half-width row (see PropertyRow); empty, it shows just its label. */
  compact?: boolean;
  /** Icon and value only (see PropertyRow); empty, it shows the placeholder. */
  inline?: boolean;
  onChange: (value: DateValue | null) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = () => setAnchor(null);
  const apply = (next: DateValue | null) => {
    onChange(next);
    close();
  };
  const display = value
    ? value.end
      ? formatSpan(fromDateValue(value), fromDateValue(value.end), today)
      : formatWhen(fromDateValue(value), today)
    : placeholder;
  // Two short lines instead of one long one, so neither is cut short: a span's start over its
  // end, and in the narrow header (inline) a timed date's day over its time.
  const span = (() => {
    if (!value) return null;
    const start = fromDateValue(value);
    if (value.end) {
      const end = fromDateValue(value.end);
      const endTime = timePart(end);
      return {
        start: formatWhen(start, today),
        end: t('date.spanEnd', {
          end:
            datePart(start) === datePart(end) && endTime
              ? formatTime(endTime)
              : formatWhen(end, today),
        }),
      };
    }
    const time = timePart(start);
    if (inline && time) {
      return { start: formatDay(datePart(start), today), end: formatTime(time) };
    }
    return null;
  })();
  const color = value ? (valueColor ?? 'text.primary') : 'text.disabled';

  return (
    <>
      <PropertyRow
        label={label}
        icon={icon}
        ariaValue={display}
        iconColor={value ? (valueColor ?? 'text.secondary') : 'text.secondary'}
        compact={compact}
        inline={inline}
        onClick={setAnchor}
      >
        {span ? (
          <Box sx={{ display: 'grid', color, lineHeight: 1.25 }} aria-hidden>
            <Typography variant="body2" noWrap sx={{ lineHeight: 'inherit' }}>
              {span.start}
            </Typography>
            <Typography variant="body2" noWrap sx={{ lineHeight: 'inherit' }}>
              {span.end}
            </Typography>
          </Box>
        ) : (
          (value || !compact) && <Typography sx={{ color }}>{display}</Typography>
        )}
      </PropertyRow>
      <PropertySheet label={label} anchor={anchor} onClose={close}>
        {anchor && (
          <DatePickerPanel
            allowRange={allowRange}
            value={value}
            today={today}
            onApply={apply}
            onCancel={close}
          />
        )}
      </PropertySheet>
    </>
  );
}
