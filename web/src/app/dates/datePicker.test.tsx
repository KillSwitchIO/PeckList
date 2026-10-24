import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockViewport, renderThemed as render } from '../../test/renderApp.tsx';
import { formatSpan } from '../format.ts';
import { DatePickerPanel } from './DatePickerPanel.tsx';
import { DateProperty } from './DateProperty.tsx';
import { fromDateValue, toDateValue, type DateValue } from './dateValue.ts';
import { MonthCalendar } from './MonthCalendar.tsx';

const TODAY = '2026-10-20';

beforeEach(() => {
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

describe('MonthCalendar', () => {
  it('shows the month of the selection with today and the selected day marked', () => {
    render(
      <MonthCalendar
        selected="2026-07-21"
        today={TODAY}
        onSelect={() => undefined}
        locale="en-US"
      />,
    );
    expect(screen.getByText('July')).toBeInTheDocument();
    expect(screen.getByRole('gridcell', { name: 'Tuesday, July 21, 2026' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // A run of weeks, not a single month: the selected week sits at the top.
    expect(screen.getAllByRole('row').length).toBeGreaterThanOrEqual(6);
  });

  it('zooms out to the months of a year and to years, and back in', async () => {
    render(
      <MonthCalendar selected={null} today={TODAY} onSelect={() => undefined} locale="en-US" />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'October' }));
    expect(screen.getByRole('button', { name: 'October 2026' })).toHaveAttribute(
      'aria-current',
      'date',
    );
    expect(screen.getByText('2026')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show next year' }));
    expect(screen.getByText('2027')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '2027' }));
    expect(screen.getByText('2022 - 2033')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show later years' }));
    expect(screen.getByText('2034 - 2045')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '2040' }));
    await userEvent.click(screen.getByRole('button', { name: 'March 2040' }));
    expect(screen.getByText('March 2040')).toBeInTheDocument();
    expect(screen.getByRole('gridcell', { name: 'Thursday, March 1, 2040' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Go to today' }));
    expect(screen.getByText('October')).toBeInTheDocument();
  });

  it('pages months, jumps back to today and selects a day', async () => {
    const onSelect = vi.fn();
    render(<MonthCalendar selected={null} today={TODAY} onSelect={onSelect} locale="en-US" />);
    expect(screen.getByText('October')).toBeInTheDocument();
    expect(screen.getByRole('gridcell', { name: 'Tuesday, October 20, 2026' })).toHaveAttribute(
      'aria-current',
      'date',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Show next month' }));
    expect(screen.getByText('November')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show previous month' }));
    await userEvent.click(screen.getByRole('button', { name: 'Show previous month' }));
    expect(screen.getByText('September')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Go to today' }));
    expect(screen.getByText('October')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('gridcell', { name: 'Friday, October 30, 2026' }));
    expect(onSelect).toHaveBeenCalledWith('2026-10-30');
  });

  it('moves focus with the arrow keys across month boundaries', async () => {
    render(
      <MonthCalendar
        selected="2026-10-31"
        today={TODAY}
        onSelect={() => undefined}
        locale="en-US"
      />,
    );
    screen.getByRole('gridcell', { name: 'Saturday, October 31, 2026' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('gridcell', { name: 'Sunday, November 1, 2026' })).toHaveAttribute(
      'tabindex',
      '0',
    );
    await userEvent.keyboard('{ArrowUp}{ArrowLeft}{ArrowDown}');
    expect(
      screen.getByRole('gridcell', { name: 'Saturday, October 31, 2026' }),
    ).toBeInTheDocument();
  });
});

describe('DatePickerPanel', () => {
  function setup(value: { date: string; time: string | null } | null = null) {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    render(<DatePickerPanel value={value} today={TODAY} onApply={onApply} onCancel={onCancel} />);
    return { onApply, onCancel };
  }

  it('applies quick picks immediately', async () => {
    const { onApply } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    await userEvent.click(screen.getByRole('button', { name: 'Tomorrow' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next week' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(onApply.mock.calls).toEqual([
      [{ date: TODAY, time: null }],
      [{ date: '2026-10-21', time: null }],
      [{ date: '2026-10-27', time: null }],
      [{ date: '2026-11-20', time: null }],
    ]);
  });

  it('shows what each quick pick sets under its icon', () => {
    setup();
    expect(screen.getAllByTestId('quick-hint').map((hint) => hint.textContent)).toEqual([
      'Tue',
      'Wed',
      'Oct 27',
      'Nov 20',
    ]);
  });

  it('a quick pick changes the day and keeps the time', async () => {
    const { onApply } = setup({ date: TODAY, time: '09:00' });
    await userEvent.click(screen.getByRole('button', { name: 'Tomorrow' }));
    expect(onApply).toHaveBeenCalledWith({ date: '2026-10-21', time: '09:00' });
  });

  it('highlights the quick pick matching the current value', () => {
    setup({ date: '2026-10-21', time: null });
    expect(screen.getByRole('button', { name: 'Tomorrow' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('applies a calendar day and time on OK', async () => {
    const { onApply } = setup();
    await userEvent.click(screen.getByRole('gridcell', { name: /October 23, 2026/ }));
    expect(onApply).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Time/ }));
    await userEvent.type(screen.getByLabelText('Time'), '09:30');
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onApply).toHaveBeenCalledWith({ date: '2026-10-23', time: '09:30' });
  });

  it('selects the typed time on focus, so typing replaces it', async () => {
    const { onApply } = setup({ date: '2026-10-23', time: '09:00' });
    await userEvent.click(screen.getByRole('button', { name: /Time/ }));
    const field = screen.getByLabelText('Time');
    await userEvent.click(field);
    await userEvent.keyboard('1030');
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onApply).toHaveBeenCalledWith({ date: '2026-10-23', time: '10:30' });
  });

  it('picking a time with no date uses today; time can be removed', async () => {
    const { onApply } = setup();
    await userEvent.click(screen.getByRole('button', { name: /Time/ }));
    await userEvent.type(screen.getByLabelText('Time'), '07:15');
    await userEvent.click(screen.getByRole('button', { name: 'Remove time' }));
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onApply).toHaveBeenCalledWith({ date: TODAY, time: null });
  });

  it.each([
    ['09', '09:00', '9:00 AM'],
    ['22', '22:00', '10:00 PM'],
    ['2215', '22:15', '10:15 PM'],
    ['10pm', '22:00', '10:00 PM'],
  ])('typing %s saves %s and previews %s', async (typed, saved, shown) => {
    const { onApply } = setup({ date: TODAY, time: null });
    await userEvent.click(screen.getByRole('button', { name: /Time/ }));
    await userEvent.type(screen.getByLabelText('Time'), typed);
    expect(screen.getByText(shown)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onApply).toHaveBeenCalledWith({ date: TODAY, time: saved });
  });

  it('flags times it cannot read and keeps the previous time', async () => {
    const { onApply } = setup({ date: TODAY, time: '08:00' });
    await userEvent.click(screen.getByRole('button', { name: /Time/ }));
    const field = screen.getByLabelText('Time');
    expect(field).toHaveValue('8:00 AM');
    await userEvent.clear(field);
    await userEvent.type(field, '25{Enter}');
    expect(screen.getByText('Try 9, 0930, 21:00 or 9pm')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onApply).toHaveBeenCalledWith({ date: TODAY, time: '08:00' });
  });

  it('clearing the time field removes the time', async () => {
    const { onApply } = setup({ date: TODAY, time: '08:00' });
    await userEvent.click(screen.getByRole('button', { name: /Time/ }));
    await userEvent.clear(screen.getByLabelText('Time'));
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onApply).toHaveBeenCalledWith({ date: TODAY, time: null });
  });

  it('No date removes the date', async () => {
    const first = setup({ date: TODAY, time: null });
    await userEvent.click(screen.getByRole('button', { name: 'No date' }));
    expect(first.onApply).toHaveBeenCalledWith(null);
  });

  it('OK without a date cancels', async () => {
    const { onApply, onCancel } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onCancel).toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe('time wheels on touch screens', () => {
  function touchScreen() {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('any-pointer: coarse'),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }));
  }

  it('shows hour, minute and AM/PM wheels starting at 9:00 AM', async () => {
    touchScreen();
    const onApply = vi.fn();
    render(
      <DatePickerPanel value={null} today={TODAY} onApply={onApply} onCancel={() => undefined} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Time/ }));
    expect(screen.queryByLabelText('Time')).toBeNull();
    const hour = screen.getByRole('listbox', { name: 'Hour' });
    expect(within(hour).getByRole('option', { selected: true })).toHaveTextContent('9');
    expect(
      within(screen.getByRole('listbox', { name: 'Minute' })).getByRole('option', {
        selected: true,
      }),
    ).toHaveTextContent('00');
    expect(
      within(screen.getByRole('listbox', { name: 'AM or PM' })).getByRole('option', {
        selected: true,
      }),
    ).toHaveTextContent('AM');
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onApply).toHaveBeenCalledWith({ date: TODAY, time: '09:00' });
  });

  it('tablets get the wheels even without a touch pointer', async () => {
    mockViewport('tablet');
    render(
      <DatePickerPanel
        value={null}
        today={TODAY}
        onApply={() => undefined}
        onCancel={() => undefined}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Time/ }));
    expect(screen.getByRole('listbox', { name: 'Hour' })).toBeInTheDocument();
  });

  it('large desktop screens keep the typed field', async () => {
    mockViewport('desktop');
    render(
      <DatePickerPanel
        value={null}
        today={TODAY}
        onApply={() => undefined}
        onCancel={() => undefined}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Time/ }));
    expect(screen.getByLabelText('Time')).toBeInTheDocument();
    expect(screen.queryByRole('listbox', { name: 'Hour' })).toBeNull();
  });

  it('tapping and arrow keys change the time; 12 AM and PM convert correctly', async () => {
    touchScreen();
    const onApply = vi.fn();
    render(
      <DatePickerPanel
        value={{ date: TODAY, time: '08:00' }}
        today={TODAY}
        onApply={onApply}
        onCancel={() => undefined}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Time/ }));
    await userEvent.click(
      within(screen.getByRole('listbox', { name: 'Hour' })).getByRole('option', { name: '10' }),
    );
    await userEvent.click(
      within(screen.getByRole('listbox', { name: 'AM or PM' })).getByRole('option', { name: 'PM' }),
    );
    const minute = screen.getByRole('listbox', { name: 'Minute' });
    minute.focus();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}');
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onApply).toHaveBeenLastCalledWith({ date: TODAY, time: '22:01' });
  });

  it('12 on the wheel is noon or midnight', async () => {
    touchScreen();
    const onApply = vi.fn();
    render(
      <DatePickerPanel
        value={{ date: TODAY, time: '00:30' }}
        today={TODAY}
        onApply={onApply}
        onCancel={() => undefined}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Time/ }));
    expect(
      within(screen.getByRole('listbox', { name: 'Hour' })).getByRole('option', { selected: true }),
    ).toHaveTextContent('12');
    await userEvent.click(
      within(screen.getByRole('listbox', { name: 'AM or PM' })).getByRole('option', { name: 'PM' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onApply).toHaveBeenLastCalledWith({ date: TODAY, time: '12:30' });
  });
});

describe('DatePickerPanel durations', () => {
  function setup(value: DateValue | null = null) {
    const onApply = vi.fn();
    render(
      <DatePickerPanel
        value={value}
        today={TODAY}
        allowRange
        onApply={onApply}
        onCancel={() => undefined}
      />,
    );
    return { onApply };
  }

  it('turns a timed date into a span with an hour by default, then sets the end', async () => {
    const { onApply } = setup({ date: TODAY, time: '09:00' });
    await userEvent.click(screen.getByRole('button', { name: 'Duration' }));
    expect(screen.getByRole('button', { name: 'Start: Today 9:00 AM' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'End: Today 10:00 AM' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^End:/ }));
    await userEvent.click(screen.getByRole('gridcell', { name: /October 22, 2026/ }));
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onApply).toHaveBeenCalledWith({
      date: TODAY,
      time: '09:00',
      end: { date: '2026-10-22', time: '10:00' },
    });
  });

  it('picks an all-day span start then end, shading the days between', async () => {
    const { onApply } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Duration' }));
    expect(screen.getByRole('switch', { name: 'All day' })).toBeChecked();
    await userEvent.click(screen.getByRole('gridcell', { name: /October 21, 2026/ }));
    // Picking the start moves on to the end.
    expect(screen.getByRole('button', { name: /^End:/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('gridcell', { name: /October 23, 2026/ }));
    for (const day of [21, 23]) {
      expect(
        screen.getByRole('gridcell', { name: new RegExp(`October ${day}, 2026`) }),
      ).toHaveAttribute('aria-selected', 'true');
    }
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onApply).toHaveBeenCalledWith({
      date: '2026-10-21',
      time: null,
      end: { date: '2026-10-23', time: null },
    });
  });

  it('opens on Duration when the task has a span, on Date otherwise', () => {
    setup({ date: TODAY, time: null, end: { date: '2026-10-22', time: null } });
    expect(screen.getByRole('button', { name: 'Duration' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /^End: Thu, Oct 22/ })).toBeInTheDocument();
  });

  it('opens on Date for a single date', () => {
    setup({ date: TODAY, time: '09:00' });
    expect(screen.getByRole('button', { name: 'Date' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows a saved span under Duration; switching back to Date drops the end', async () => {
    const { onApply } = setup({ date: TODAY, time: null, end: { date: '2026-10-22', time: null } });
    await userEvent.click(screen.getByRole('button', { name: 'Duration' }));
    expect(screen.getByRole('button', { name: /^End: Thu, Oct 22/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Date' }));
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onApply).toHaveBeenCalledWith({ date: TODAY, time: null });
  });

  it('setting one field never moves the other', async () => {
    const { onApply } = setup({
      date: TODAY,
      time: '09:00',
      end: { date: TODAY, time: '10:00' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Duration' }));
    await userEvent.click(screen.getByRole('button', { name: /^End:/ }));
    await userEvent.click(screen.getByRole('button', { name: /^Time/ }));
    await userEvent.clear(screen.getByLabelText('Time'));
    await userEvent.type(screen.getByLabelText('Time'), '1022');
    await userEvent.click(screen.getByRole('button', { name: /^Start:/ }));
    await userEvent.click(screen.getByRole('button', { name: /^Time/ }));
    await userEvent.clear(screen.getByLabelText('Time'));
    await userEvent.type(screen.getByLabelText('Time'), '0800');
    expect(screen.getByRole('button', { name: 'End: Today 10:22 AM' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onApply).toHaveBeenCalledWith({
      date: TODAY,
      time: '08:00',
      end: { date: TODAY, time: '10:22' },
    });
  });

  it('swaps an end picked before the start', async () => {
    const { onApply } = setup({
      date: '2026-10-25',
      time: null,
      end: { date: '2026-10-26', time: null },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Duration' }));
    await userEvent.click(screen.getByRole('button', { name: /^End:/ }));
    await userEvent.click(screen.getByRole('gridcell', { name: /October 23, 2026/ }));
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onApply).toHaveBeenCalledWith({
      date: '2026-10-23',
      time: null,
      end: { date: '2026-10-25', time: null },
    });
  });
});

describe('DateProperty', () => {
  it('shows a placeholder, opens the picker and reports the choice', async () => {
    const onChange = vi.fn();
    render(
      <DateProperty
        label="Date"
        icon={<span />}
        value={null}
        today={TODAY}
        placeholder="Add date"
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Date: Add date' }));
    const dialog = await screen.findByRole('dialog', { name: 'Date' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Tomorrow' }));
    expect(onChange).toHaveBeenCalledWith({ date: '2026-10-21', time: null });
  });

  it('shows the value with its time', () => {
    render(
      <DateProperty
        label="Due"
        icon={<span />}
        value={{ date: TODAY, time: '09:00' }}
        today={TODAY}
        placeholder="Add due date"
        valueColor="#C8524C"
        onChange={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: /Due: Today 9:00/ })).toBeInTheDocument();
  });

  it('opens as a bottom sheet on phones', async () => {
    mockViewport('phone');
    render(
      <DateProperty
        label="Date"
        icon={<span />}
        value={null}
        today={TODAY}
        placeholder="Add date"
        onChange={() => undefined}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Date: Add date' }));
    expect(await screen.findByRole('dialog', { name: 'Date' })).toBeInTheDocument();
  });
});

describe('date values', () => {
  it('convert to and from stored strings', () => {
    expect(toDateValue('2026-10-20T09:30')).toEqual({ date: '2026-10-20', time: '09:30' });
    expect(toDateValue('2026-10-20')).toEqual({ date: '2026-10-20', time: null });
    expect(toDateValue(undefined)).toBeNull();
    expect(fromDateValue({ date: '2026-10-20', time: null })).toBe('2026-10-20');
  });
});

describe('spans', () => {
  it('format a span for display', () => {
    expect(formatSpan('2026-10-20T09:00', '2026-10-20T11:00', TODAY, 'en-US')).toBe(
      'Today 9:00 AM - 11:00 AM',
    );
    expect(formatSpan('2026-10-20', '2026-10-22', TODAY, 'en-US')).toBe('Today - Thu, Oct 22');
  });

  it('read a stored start and end back as a span', () => {
    expect(toDateValue('2026-10-20T09:00', '2026-10-20T10:00')).toEqual({
      date: '2026-10-20',
      time: '09:00',
      end: { date: '2026-10-20', time: '10:00' },
    });
  });
});
