import { vi } from 'vitest';

/**
 * A browser with passkeys, for tests (PL-123): `navigator.credentials` answers create and get with
 * one credential named `id`, and autofill (conditional UI) is not offered. Returns the two mocks.
 */
export function fakeWebAuthn(id = 'cred-1') {
  const buffer = (value: string) => new TextEncoder().encode(value).buffer;
  const credential = {
    id,
    rawId: buffer(id),
    type: 'public-key',
    getClientExtensionResults: () => ({}),
    response: {
      attestationObject: buffer('attestation'),
      clientDataJSON: buffer('client data'),
      getTransports: () => ['internal'],
      authenticatorData: buffer('authenticator data'),
      signature: buffer('signature'),
      userHandle: buffer('user'),
    },
  };
  const create = vi.fn(() => Promise.resolve(credential));
  const get = vi.fn(() => Promise.resolve(credential));
  vi.stubGlobal(
    'PublicKeyCredential',
    Object.assign(function PublicKeyCredential() {}, {
      isConditionalMediationAvailable: () => Promise.resolve(false),
    }),
  );
  Object.defineProperty(navigator, 'credentials', { value: { create, get }, configurable: true });
  return { create, get };
}

/** Back to a browser without passkeys. */
export function noWebAuthn(): void {
  Reflect.deleteProperty(navigator, 'credentials');
}
