import { describe, expect, it } from 'vitest';
import { heldPresses, phoneChannels, shellInfo, storePage } from './capacitor-shell.ts';

describe('storePage', () => {
  it('takes a page the shell answered with, and refuses anything else rather than read it as empty', () => {
    expect(storePage({ header: '{"doc":{}}', rows: [['tasks/1', '{}']], next: 'tasks/1' })).toEqual(
      { header: '{"doc":{}}', rows: [['tasks/1', '{}']], next: 'tasks/1' },
    );
    expect(storePage({ header: null, rows: [], next: null })).toEqual({
      header: null,
      rows: [],
      next: null,
    });
    expect(() => storePage({ header: 3, rows: [] })).toThrow();
    expect(() => storePage({ header: null, rows: [['tasks/1', 2]] })).toThrow();
    expect(() => storePage({ header: null })).toThrow();
    expect(() => storePage(null)).toThrow();
  });
});

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

describe('shellInfo', () => {
  const answer = { api: 15, server: 'https://tasks.example.com', version: '0.15.0' };

  it('passes on the app that installed it, or null when Android does not say', () => {
    expect(shellInfo({ ...answer, installer: 'org.fdroid.fdroid' }).installer).toBe(
      'org.fdroid.fdroid',
    );
    expect(shellInfo({ ...answer, installer: null }).installer).toBeNull();
    expect(shellInfo({ ...answer, installer: 7 as never }).installer).toBeNull();
  });

  it('passes on the app that asked for the install the same way', () => {
    expect(
      shellInfo({ ...answer, installRequestedBy: 'org.fdroid.fdroid' }).installRequestedBy,
    ).toBe('org.fdroid.fdroid');
    expect(shellInfo({ ...answer, installRequestedBy: {} as never }).installRequestedBy).toBeNull();
  });

  it('an older shell says nothing of it, and nothing is made up', () => {
    expect(shellInfo(answer)).not.toHaveProperty('installer');
    expect(shellInfo(answer)).not.toHaveProperty('installRequestedBy');
    expect(shellInfo({ ...answer, distribution: 'beta' as never })).not.toHaveProperty(
      'distribution',
    );
  });
});
