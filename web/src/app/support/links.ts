/**
 * Every way to support PeckList, in one file so the app never disagrees with the site and the
 * README (spec: PL-112). Links leave the app: no payment runs in it, and nothing here is fetched.
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

/** Each entry gets a button on the card, in this order. PayPal joins here once it has a link. */
export const DONATION_PLATFORMS: readonly DonationPlatform[] = [
  { name: 'Ko-fi', url: 'https://ko-fi.com/S6S7P3FVW' },
];

/**
 * Empty until crypto is decided. The entries are ready to add here, but the card still needs what
 * PL-112 asks of them: a fold with Copy, a locally made QR code and the explorer link.
 */
export const CRYPTO_ADDRESSES: readonly CryptoAddress[] = [];
