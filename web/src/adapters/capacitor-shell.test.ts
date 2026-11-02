import { describe, expect, it } from 'vitest';
import { heldPresses } from './capacitor-shell.ts';

describe('heldPresses', () => {
  it('keeps the presses the shell answered with, and leaves out any it got wrong', () => {
    const good = { action: 'complete', taskId: 'T1', minutes: 10, at: 1 };
    expect(
      heldPresses({
        presses: [good, { ...good, action: 'open' }, { ...good, taskId: 3 }, null, 'x'],
      }),
    ).toEqual([good]);
    expect(heldPresses({})).toEqual([]);
  });
});
