import { Typography } from '@mui/material';
import { useState, type ReactNode } from 'react';
import { formatSpan, formatWhen } from '../format.ts';
import { PropertyRow, PropertySheet } from '../tasks/PropertyRow.tsx';
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
        {(value || !compact) && (
          <Typography sx={{ color: value ? (valueColor ?? 'text.primary') : 'text.disabled' }}>
            {display}
          </Typography>
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
