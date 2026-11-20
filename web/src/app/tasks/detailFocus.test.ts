import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { focusRow, SETTLE_MS } from './detailFocus.ts';

/** A main with the task rows as buttons, as TaskRow draws them, plus something else to focus. */
function rows(...ids: string[]): HTMLElement {
  const main = document.createElement('main');
  for (const id of ids) main.append(rowButton(id));
  const other = document.createElement('button');
  other.textContent = 'Closed 5';
  main.append(other);
  document.body.append(main);
  return main;
}

function rowButton(id: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.dataset.taskRow = id;
  button.textContent = `Open ${id}`;
  return button;
}

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('the keyboard back on the row after the details close', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('follows the row when closing rebuilds the list', async () => {
    const main = rows('t1', 't2');
    focusRow('t2');
    expect(document.activeElement).toHaveTextContent('Open t2');

    // The wider list draws its rows again: the focused button is replaced and the focus drops.
    const again = rowButton('t2');
    main.replaceChildren(rowButton('t1'), again);
    await flush();

    expect(document.activeElement).toBe(again);
  });

  it('takes the focus back from a stray move while the list settles', async () => {
    const main = rows('t1');
    focusRow('t1');
    main.querySelector<HTMLElement>('button:not([data-task-row])')!.focus();
    await flush();

    expect(document.activeElement).toHaveTextContent('Open t1');
  });

  it('leaves the focus where the person takes it, and stops after the moment', async () => {
    const main = rows('t1');
    focusRow('t1');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    const other = main.querySelector<HTMLElement>('button:not([data-task-row])')!;
    other.focus();
    await flush();
    expect(document.activeElement).toBe(other);

    // Closed again with the focus on the page: followed for the moment, then left alone.
    other.blur();
    focusRow('t1');
    other.focus();
    expect(document.activeElement).toHaveTextContent('Open t1');
    vi.advanceTimersByTime(SETTLE_MS);
    other.focus();
    main.prepend(rowButton('t9'));
    await flush();
    expect(document.activeElement).toBe(other);
  });

  it('does nothing when the focus is already somewhere of its own', () => {
    const main = rows('t1');
    const other = main.querySelector<HTMLElement>('button:not([data-task-row])')!;
    other.focus();
    focusRow('t1');
    expect(document.activeElement).toBe(other);
  });
});
