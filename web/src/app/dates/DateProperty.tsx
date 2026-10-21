import { Typography } from '@mui/material';
import { useState, type ReactNode } from 'react';
import { formatWhen } from '../format.ts';
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
  onChange,
}: {
  label: string;
  icon: ReactNode;
  value: DateValue | null;
  today: string;
  placeholder: string;
  valueColor?: string;
  onChange: (value: DateValue | null) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = () => setAnchor(null);
  const apply = (next: DateValue | null) => {
    onChange(next);
    close();
  };
  const display = value ? formatWhen(fromDateValue(value), today) : placeholder;

  return (
    <>
      <PropertyRow
        label={label}
        icon={icon}
        ariaValue={display}
        iconColor={value ? (valueColor ?? 'text.secondary') : 'text.secondary'}
        onClick={setAnchor}
      >
        <Typography sx={{ color: value ? (valueColor ?? 'text.primary') : 'text.disabled' }}>
          {display}
        </Typography>
      </PropertyRow>
      <PropertySheet label={label} anchor={anchor} onClose={close}>
        {anchor && <DatePickerPanel value={value} today={today} onApply={apply} onCancel={close} />}
      </PropertySheet>
    </>
  );
}
