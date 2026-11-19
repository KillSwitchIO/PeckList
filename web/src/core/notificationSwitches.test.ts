import { describe, expect, it } from 'vitest';
import { withPhoneChannels } from './notificationSwitches.ts';

describe('withPhoneChannels', () => {
  it('carries a kind switched on the phone into its switch', () => {
    expect(withPhoneChannels(undefined, { comments: false })).toEqual({ comments: false });
    expect(withPhoneChannels({ comments: false, vibrate: false }, { comments: true })).toEqual({
      comments: true,
      vibrate: false,
    });
  });

  it('changes nothing when the switches already agree (absent means on)', () => {
    expect(withPhoneChannels(undefined, { reminders: true })).toBeNull();
    expect(withPhoneChannels({ shares: false }, { shares: false })).toBeNull();
    expect(withPhoneChannels({ shares: false }, {})).toBeNull();
  });
});
