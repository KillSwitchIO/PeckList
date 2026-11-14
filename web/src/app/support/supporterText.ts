import type { SupporterKeyInfo } from '../../ports/sync.ts';

/** Where supporter keys are bought: the website, never the app (PL-112). */
export const SUPPORTER_KEY_URL = 'https://pecklist.com/support';

/** A key's purchase date as people read it. The date is a calendar day, so no time zone moves it. */
export function purchasedText(key: SupporterKeyInfo): string {
  return new Date(`${key.purchased}T00:00:00Z`).toLocaleDateString(undefined, {
    dateStyle: 'long',
    timeZone: 'UTC',
  });
}
