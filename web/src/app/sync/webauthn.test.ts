import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeWebAuthn, noWebAuthn } from '../../test/fakeWebAuthn.ts';
import { passkeysWork } from './webauthn.ts';

describe('where passkeys work', () => {
  afterEach(() => {
    noWebAuthn();
    vi.unstubAllGlobals();
  });

  it('on a name, in a browser that has them', () => {
    fakeWebAuthn();
    expect(passkeysWork('tasks.example.com')).toBe(true);
    expect(passkeysWork('localhost')).toBe(true);
    // Only looks like an address.
    expect(passkeysWork('10.0.0.1.example.com')).toBe(true);
  });

  it('not on an IP address, which WebAuthn refuses', () => {
    fakeWebAuthn();
    expect(passkeysWork('127.0.0.1')).toBe(false);
    expect(passkeysWork('192.168.1.20')).toBe(false);
    expect(passkeysWork('[::1]')).toBe(false);
  });

  it('not in a browser without them', () => {
    noWebAuthn();
    expect(passkeysWork('tasks.example.com')).toBe(false);
  });
});
