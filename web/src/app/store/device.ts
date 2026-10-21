// Node ids for HLC timestamps: one stable id per device (browser profile), plus a per-tab
// suffix so two tabs never produce identical timestamps.

const DEVICE_KEY = 'punchlist.deviceId';
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZabcdefghjkmnpqrstvwxyz0123456789';

export function randomId(length: number, random: () => number = Math.random): string {
  let value = '';
  for (let i = 0; i < length; i += 1)
    value += ALPHABET.charAt(Math.floor(random() * ALPHABET.length));
  return value;
}

export function deviceId(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeLocalStorage(),
): string {
  const existing = storage?.getItem(DEVICE_KEY);
  if (existing && /^[A-Za-z0-9]{8}$/.test(existing)) return existing;
  const created = randomId(8);
  storage?.setItem(DEVICE_KEY, created);
  return created;
}

export function tabNodeId(): string {
  return `${deviceId()}${randomId(4)}`;
}

function safeLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
