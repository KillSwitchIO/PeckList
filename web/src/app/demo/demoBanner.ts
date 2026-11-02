// The demo banner's dismissal (PL-117): for this tab's session only, so the next visit sees it
// again. Storage may be missing or refuse (private windows); the banner then just shows.
import type { DemoInfo } from '../../ports/sync.ts';
import { t } from '../i18n/i18n.ts';

const KEY = 'punchlist.demoBanner';

export function bannerDismissed(): boolean {
  try {
    return sessionStorage.getItem(KEY) === 'hidden';
  } catch {
    return false;
  }
}

export function dismissBanner(): void {
  try {
    sessionStorage.setItem(KEY, 'hidden');
  } catch {
    // Hidden until the page reloads, which is all a refusing browser allows.
  }
}

/**
 * What the banner says about the reset: nightly at a time, or every so often
 * (`DEMO_RESET_EVERY`, minutes).
 */
export function resetWording(demo: DemoInfo): {
  banner: string;
  short: string;
  accounts: string;
  noAccounts: string;
} {
  const minutes = demo.resetEveryMinutes ?? 1440;
  if (minutes >= 1440) {
    const time = demo.resetTime;
    return {
      banner: t('demo.banner', { time }),
      short: t('demo.bannerShort', { time }),
      accounts: t('demo.accountsText', { time }),
      noAccounts: t('demo.noAccountsText', { time }),
    };
  }
  const every =
    minutes === 60
      ? t('demo.everyHour')
      : minutes % 60 === 0
        ? t('demo.everyHours', { count: minutes / 60 })
        : t('demo.everyMinutes', { count: minutes });
  return {
    banner: t('demo.bannerEvery', { every }),
    short: t('demo.bannerShortEvery', { every }),
    accounts: t('demo.accountsTextEvery', { every }),
    noAccounts: t('demo.noAccountsTextEvery', { every }),
  };
}
