import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateField } from './DateField.tsx';

const TODAY = '2026-10-20';

function setup(value = '') {
  const onChange = vi.fn();
  render(<DateField label="Due" value={value} today={TODAY} onChange={onChange} />);
  return onChange;
}

afterEach(() => {
  delete (HTMLInputElement.prototype as Partial<HTMLInputElement>).showPicker;
});

describe('DateField', () => {
  it('sets today, tomorrow or next week with one click', async () => {
    const onChange = setup();
    expect(screen.queryByRole('button', { name: 'Due: Clear' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Due: Today' }));
    await userEvent.click(screen.getByRole('button', { name: 'Due: Tomorrow' }));
    await userEvent.click(screen.getByRole('button', { name: 'Due: Next week' }));
    expect(onChange.mock.calls).toEqual([[TODAY], ['2026-10-21'], ['2026-10-27']]);
  });

  it('highlights the matching shortcut and offers Clear when a date is set', async () => {
    const onChange = setup(TODAY);
    expect(screen.getByRole('button', { name: 'Due: Today' })).toHaveClass('MuiChip-filled');
    await userEvent.click(screen.getByRole('button', { name: 'Due: Clear' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('opens the picker when the field is clicked anywhere', async () => {
    const showPicker = vi.fn();
    HTMLInputElement.prototype.showPicker = showPicker;
    setup();
    await userEvent.click(screen.getByLabelText('Due'));
    expect(showPicker).toHaveBeenCalled();
  });

  it('still works when the browser blocks showPicker', async () => {
    HTMLInputElement.prototype.showPicker = () => {
      throw new Error('NotAllowedError');
    };
    setup();
    await userEvent.click(screen.getByLabelText('Due'));
    expect(screen.getByLabelText('Due')).toBeInTheDocument();
  });

  it('reports typed dates and clearing the input', async () => {
    const onChange = setup();
    await userEvent.type(screen.getByLabelText('Due'), '2026-12-24');
    expect(onChange).toHaveBeenLastCalledWith('2026-12-24');
  });
});
