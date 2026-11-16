/**
 * Every way to support PeckList, in one file so the app never disagrees with the site and the
 * README (spec: PL-112). Links leave the app: no payment runs in it, and nothing here is fetched.
 * The Google Play build of the Android app never opens them: a new platform's site goes in the
 * shell's PaymentLinks.java too (its test reads this folder and fails otherwise).
 */

export interface DonationPlatform {
  /** As people know it: its name goes on the button. */
  name: string;
  url: string;
}

/** A coin to send to directly. The card shows none of these until crypto is decided. */
export interface CryptoAddress {
  symbol: string;
  address: string;
  /** This address on a block explorer. */
  explorerUrl: string;
}

/** Each entry gets a button on the card, in this order. */
export const DONATION_PLATFORMS: readonly DonationPlatform[] = [
  { name: 'Ko-fi', url: 'https://ko-fi.com/S6S7P3FVW' },
  { name: 'PayPal', url: 'https://www.paypal.com/donate/?hosted_button_id=NF3EZPGC3NL86' },
];

/**
 * Empty until crypto is decided. The entries are ready to add here, but the card still needs what
 * PL-112 asks of them: a fold with Copy, a locally made QR code and the explorer link.
 */
export const CRYPTO_ADDRESSES: readonly CryptoAddress[] = [];
