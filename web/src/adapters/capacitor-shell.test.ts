import { describe, expect, it } from 'vitest';
import { heldPresses, phoneChannels } from './capacitor-shell.ts';

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

describe('phoneChannels', () => {
  it('keeps the kinds the shell knows, and only true or false', () => {
    expect(
      phoneChannels({
        channels: { reminders: true, constant: false, mystery: true, shares: 'yes' } as never,
        changed: { comments: false, constant: true } as never,
      }),
    ).toEqual({ channels: { reminders: true, constant: false }, changed: { comments: false } });
    expect(phoneChannels(null)).toEqual({ channels: {}, changed: {} });
  });
});
