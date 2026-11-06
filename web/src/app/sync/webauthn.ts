// WebAuthn in the browser for passkeys (PL-123): the server's options arrive as JSON with
// base64url bytes, and the browser's answers go back the same way. Written out by hand rather
// than with PublicKeyCredential.parse*FromJSON and toJSON(), which older browsers lack.

function bytes(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) out[index] = binary.charCodeAt(index);
  return out.buffer;
}

function text(buffer: ArrayBuffer | null | undefined): string | null {
  if (!buffer) return null;
  let binary = '';
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

type Json = Record<string, unknown>;
type Descriptor = { id: string; type?: string; transports?: string[] };

function descriptors(list: unknown): PublicKeyCredentialDescriptor[] {
  return ((list as Descriptor[] | undefined) ?? []).map((each) => ({
    type: 'public-key',
    id: bytes(each.id),
    ...(each.transports ? { transports: each.transports as AuthenticatorTransport[] } : {}),
  }));
}

/**
 * Whether passkeys can work here: a browser that does them, on an address with a name. WebAuthn
 * refuses IP addresses outright, and `http://127.0.0.1` still counts as secure, so the browser's
 * API is there on such a page and only fails when called.
 */
export function passkeysWork(host = window.location.hostname): boolean {
  const onIpAddress = /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith('[');
  return (
    !onIpAddress && typeof window.PublicKeyCredential === 'function' && !!navigator.credentials
  );
}

/** Whether passkeys can be offered in the username field's autofill (conditional UI). */
export async function autofillWorks(): Promise<boolean> {
  if (!passkeysWork()) return false;
  const check = (
    window.PublicKeyCredential as unknown as {
      isConditionalMediationAvailable?: () => Promise<boolean>;
    }
  ).isConditionalMediationAvailable;
  return check ? check.call(window.PublicKeyCredential).catch(() => false) : false;
}

/** Make a passkey with the server's creation options; its answer as JSON for the server. */
export async function createPasskey(options: Json): Promise<Json> {
  const user = options.user as { id: string; name: string; displayName: string };
  const publicKey = {
    ...options,
    challenge: bytes(options.challenge as string),
    user: { ...user, id: bytes(user.id) },
    excludeCredentials: descriptors(options.excludeCredentials),
  } as unknown as PublicKeyCredentialCreationOptions;
  const credential = (await navigator.credentials.create({
    publicKey,
  })) as PublicKeyCredential | null;
  if (!credential) throw new DOMException('no passkey made', 'NotAllowedError');
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: text(credential.rawId),
    type: credential.type,
    response: {
      attestationObject: text(response.attestationObject),
      clientDataJSON: text(response.clientDataJSON),
      transports: response.getTransports?.() ?? [],
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  };
}

/**
 * Sign in with a passkey: the server's request options; its answer as JSON. `autofill` offers it
 * in the username field instead of asking at once, until `signal` aborts.
 */
export async function getPasskey(
  options: Json,
  { signal, autofill = false }: { signal?: AbortSignal; autofill?: boolean } = {},
): Promise<Json> {
  const publicKey = {
    ...options,
    challenge: bytes(options.challenge as string),
    allowCredentials: descriptors(options.allowCredentials),
  } as unknown as PublicKeyCredentialRequestOptions;
  const credential = (await navigator.credentials.get({
    publicKey,
    ...(signal ? { signal } : {}),
    ...(autofill ? { mediation: 'conditional' as CredentialMediationRequirement } : {}),
  })) as PublicKeyCredential | null;
  if (!credential) throw new DOMException('no passkey chosen', 'NotAllowedError');
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: text(credential.rawId),
    type: credential.type,
    response: {
      authenticatorData: text(response.authenticatorData),
      clientDataJSON: text(response.clientDataJSON),
      signature: text(response.signature),
      userHandle: text(response.userHandle),
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  };
}

/** The person closed the browser's passkey prompt (or it timed out): nothing to report. */
export function cancelled(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'NotAllowedError' || error.name === 'AbortError')
  );
}
