// Smart links (PL-146): web addresses, email addresses, phone numbers and street addresses found
// in a task's notes, so a click can start the right thing. Found here, on the text as shown, and
// nowhere else: nothing is sent anywhere to look anything up. Conservative on purpose: a phone
// number needs a recognizable shape and an address a house number, a street name and a street
// word, because a miss is better than plain text turned into a wrong link.

export type SmartKind = 'web' | 'email' | 'phone' | 'address';

/** A found item: its kind, where it is in the text (`from` inclusive, `to` exclusive), its text. */
export interface SmartLink {
  kind: SmartKind;
  from: number;
  to: number;
  text: string;
}

/**
 * The only addresses a note ever opens (audit W3, extended for PL-146): web, mail, the dialer, a
 * text message and the maps app. Anything else (`javascript:`, `data:`, `intent:`) stays text.
 */
export function openable(href: string): boolean {
  return /^(https?:\/\/|mailto:|tel:|sms:|geo:)/i.test(href.trim());
}

// A web address: with its scheme, or starting www. Trailing punctuation is the sentence's. It
// stops at the NUL the editor puts for a hard break, code or a link (smartLinksPlugin), and at a
// CJK or full-width stop or comma.
// eslint-disable-next-line no-control-regex -- the NUL is what stops it
const WEB = /(?:https?:\/\/|www\.)[^\s<>"'`\u0000\u3000-\u303f\uff01\uff0c\uff1a\uff1b\uff1f]+/giu;

// An email address, by the usual shape. The part before @ starts and ends with a letter or digit,
// and holds no % (an encoded ? or & would come back as a header in a mailto: address).
const EMAIL =
  /[A-Za-z0-9](?:[A-Za-z0-9._+-]{0,62}[A-Za-z0-9_+-])?@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}/gu;

// A phone number with its country code: +, then groups of digits with single separators. It may
// take a group too many ("+44 20 7946 0958 2 times"); intlPhone trims those off.
const PHONE_INTL = /\+\d{1,3}(?:[ .-]?(?:\(\d{1,4}\)|\d{1,4})){2,6}/gu;
const LAST_GROUP = /[ .-]?(?:\(\d{1,4}\)|\d{1,4})$/u;
const TWO_GROUPS = /^\+\d{1,3}(?:[ .-]?(?:\(\d{1,4}\)|\d{1,4})){2,}$/u;

// A North American number, with separators: (515) 555-0123, 515-555-0123, 1 515.555.0123.
const PHONE_NANP = /(?:1[ .-]?)?(?:\([2-9]\d{2}\) ?|[2-9]\d{2}[ .-])[2-9]\d{2}[ .-]\d{4}/gu;

const STREET_WORDS = [
  'Street',
  'St',
  'Avenue',
  'Ave',
  'Road',
  'Rd',
  'Drive',
  'Dr',
  'Lane',
  'Ln',
  'Boulevard',
  'Blvd',
  'Court',
  'Ct',
  'Place',
  'Pl',
  'Way',
  'Parkway',
  'Pkwy',
  'Circle',
  'Cir',
  'Terrace',
  'Ter',
  'Trail',
  'Trl',
  'Highway',
  'Hwy',
  'Square',
  'Sq',
  'Loop',
  'Alley',
  'Crescent',
  'Close',
];
// Each as written (Main Street), lowercase (main street) or capitals (MAIN STREET).
const STREET = STREET_WORDS.flatMap((word) => [word, word.toLowerCase(), word.toUpperCase()]).join(
  '|',
);
const DIRECTION = String.raw`(?:North|South|East|West|NE|NW|SE|SW|N|S|E|W)\.?`;
// A street name's word: capitalized (Main, O'Brien, Mc-Kay) or an ordinal (5th, 22nd).
const NAME_WORD = String.raw`(?:[A-Z][A-Za-z'.-]*|\d{1,3}(?:st|nd|rd|th))`;
const ADDRESS = new RegExp(
  String.raw`\d{1,6}(?:-\d{1,4})?[A-Za-z]?` + // house number: 123, 123A, 12-14
    String.raw`\s+(?:${DIRECTION}\s+)?` +
    String.raw`(?:${NAME_WORD}\s+){1,4}` +
    String.raw`(?<street>${STREET})\b\.?` +
    String.raw`(?:\s+${DIRECTION}(?![A-Za-z]))?` +
    // Apartment or suite.
    String.raw`(?:,?\s+(?:Apt|Apartment|Unit|Suite|Ste|#)\.?\s*#?[A-Za-z0-9-]{1,6}\b)?` +
    // The town, only when a state or ZIP code follows, so ", Buy milk" is not taken for one.
    String.raw`(?:,\s*[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3},?\s+[A-Z]{2}\b(?:\s+\d{5}(?:-\d{4})?)?` +
    String.raw`|,?\s+\d{5}(?:-\d{4})?)?`,
  'gu',
);

/** Text the item may not be glued to: a letter, digit or the joining marks of a longer token. */
const GLUED_BEFORE = /[\p{L}\p{N}_@+./:-]/u;
const GLUED_AFTER = /[\p{L}\p{N}_@]/u;

const OPENERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

/**
 * The trailing punctuation of a sentence or a bracket the item sits in, off a web address. A
 * closing bracket belongs to the address only when it opened one (wiki links do). The brackets are
 * counted once, then the count follows each one taken off: linear however many there are.
 */
function trimWeb(text: string): string {
  const count = new Map<string, number>();
  for (const char of text) if ('()[]{}'.includes(char)) count.set(char, (count.get(char) ?? 0) + 1);
  let end = text.length;
  while (end > 0) {
    const last = text[end - 1] ?? '';
    if ('.,;:!?'.includes(last)) {
      end -= 1;
      continue;
    }
    const open = OPENERS[last];
    if (open !== undefined && (count.get(open) ?? 0) < (count.get(last) ?? 0)) {
      count.set(last, (count.get(last) ?? 0) - 1);
      end -= 1;
      continue;
    }
    break;
  }
  return text.slice(0, end);
}

/**
 * The international number starting at `from`, or null: the match, less any groups too many.
 * A number has 8 to 15 digits, brackets in pairs, at least one group of three digits or more
 * after the country code ("+10 15 20 25 30" is a list), and no lone digit after a space at the
 * end ("+44 20 7946 0958 2 times").
 */
function intlPhone(text: string, from: number, match: string): string | null {
  for (let candidate = match; TWO_GROUPS.test(candidate);) {
    const count = digits(candidate).length;
    if (
      !glued(text, from, from + candidate.length) &&
      count >= 8 &&
      count <= 15 &&
      (candidate.match(/\(/g) ?? []).length === (candidate.match(/\)/g) ?? []).length &&
      /\d{3}/.test(candidate.replace(/^\+\d{1,3}/, '')) &&
      !/ \d$/.test(candidate)
    ) {
      return candidate;
    }
    const shorter = candidate.replace(LAST_GROUP, '');
    if (shorter === candidate) break;
    candidate = shorter;
  }
  return null;
}

function digits(text: string): string {
  return text.replace(/\D/g, '');
}

function glued(text: string, from: number, to: number): boolean {
  const before = text[from - 1];
  const after = text[to];
  return (
    (before !== undefined && GLUED_BEFORE.test(before)) ||
    (after !== undefined && GLUED_AFTER.test(after)) ||
    // Part of a longer number: 515-555-0123-44, 555-0123.5
    (after !== undefined && /[-.]/.test(after) && /\d/.test(text[to + 1] ?? ''))
  );
}

/**
 * The items in `text`, in order and never overlapping. Where two could start in the same place
 * the first kind wins, in this order: web, email, phone, address.
 */
export function findSmartLinks(text: string): SmartLink[] {
  const found: SmartLink[] = [];
  const taken = (from: number, to: number) => found.some((f) => from < f.to && f.from < to);
  const add = (kind: SmartKind, from: number, to: number) => {
    if (to <= from || taken(from, to)) return;
    found.push({ kind, from, to, text: text.slice(from, to) });
  };

  for (const m of text.matchAll(WEB)) {
    const from = m.index;
    const before = text[from - 1];
    if (before !== undefined && /[\p{L}\p{N}_@./-]/u.test(before)) continue;
    const word = trimWeb(m[0]);
    // www. alone, or with nothing that looks like a host after the scheme.
    if (!/^(?:https?:\/\/|www\.)[\p{L}\p{N}]/iu.test(word) || /^www\.$/i.test(word)) continue;
    add('web', from, from + word.length);
  }
  for (const m of text.matchAll(EMAIL)) {
    const from = m.index;
    const to = from + m[0].length;
    const before = text[from - 1];
    if (before !== undefined && /[\p{L}\p{N}._%+-]/u.test(before)) continue;
    if (/[\p{L}\p{N}_-]/u.test(text[to] ?? '')) continue;
    add('email', from, to);
  }
  for (const m of text.matchAll(PHONE_INTL)) {
    const number = intlPhone(text, m.index, m[0]);
    if (number !== null) add('phone', m.index, m.index + number.length);
  }
  for (const m of text.matchAll(PHONE_NANP)) {
    const from = m.index;
    const to = from + m[0].length;
    if (glued(text, from, to)) continue;
    const count = digits(m[0]).length;
    if (count < 10 || count > 11) continue;
    // Brackets in pairs: "(515 555-0123" is no number.
    if ((m[0].match(/\(/g) ?? []).length !== (m[0].match(/\)/g) ?? []).length) continue;
    add('phone', from, to);
  }
  for (const m of text.matchAll(ADDRESS)) {
    const from = m.index;
    const to = from + m[0].length;
    const before = text[from - 1];
    if (before !== undefined && !/[\s("'[]/u.test(before)) continue;
    if (/[\p{L}\p{N}_]/u.test(text[to] ?? '')) continue;
    // "Dr" is also a doctor: "3 Tylenol Dr said" is no address. Taken as a street only when the
    // text ends there or a line break, comma, semicolon or bracket follows.
    if (/^dr$/i.test(m.groups?.['street'] ?? '') && /dr\.?$/i.test(m[0])) {
      if (!/^(?:[ \t]*$|[ \t]*\n|[,;)])/u.test(text.slice(to))) continue;
    }
    add('address', from, to);
  }
  return found.sort((a, b) => a.from - b.from);
}

/** A web address to open: www. ones get https://. */
export function webHref(text: string): string {
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

/** Writing to `address`: anything that would start a header or end the address is encoded. */
export function mailHref(address: string): string {
  return `mailto:${address.replace(/[%?&#\s]/g, (char) => encodeURIComponent(char))}`;
}

/**
 * The number as the dialer takes it: digits, and a leading + when it had one. A (0) after the
 * country code ("+44 (0)20 ...") is dialled only from inside the country, so it goes.
 */
export function phoneNumber(text: string): string {
  const number = text.trim().replace(/^(\+\d{1,3})[ .-]?\(0\)/, '$1');
  return (number.startsWith('+') ? '+' : '') + digits(number);
}

export function telHref(text: string): string {
  return `tel:${phoneNumber(text)}`;
}

export function smsHref(text: string): string {
  return `sms:${phoneNumber(text)}`;
}

/** An address on one line, for a map search: line breaks and runs of spaces become one space. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The maps app on Android (and other systems that handle geo:), searching for the address. */
export function geoHref(address: string): string {
  return `geo:0,0?q=${encodeURIComponent(oneLine(address))}`;
}

export function googleMapsHref(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(oneLine(address))}`;
}

export function appleMapsHref(address: string): string {
  return `https://maps.apple.com/?q=${encodeURIComponent(oneLine(address))}`;
}

export function openStreetMapHref(address: string): string {
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(oneLine(address))}`;
}

/**
 * A link already in the notes (typed, pasted or from markdown) as a smart item: mailto: ones are
 * email, the rest web. `href` is what opens: the link as written (it passed `openable`), with its
 * own ?subject= and nothing decoded into a header. `text` is what to copy: the address itself,
 * not the link's label.
 */
export function linkAsSmart(
  href: string,
): { kind: 'web' | 'email'; text: string; href: string } | null {
  if (!openable(href)) return null;
  if (/^mailto:/i.test(href)) {
    let address = href.slice('mailto:'.length).split('?')[0] ?? '';
    try {
      address = decodeURIComponent(address);
    } catch {
      // Left as written.
    }
    // An encoded ? stays out of what is copied too.
    return { kind: 'email', text: address.split('?')[0] ?? '', href: href.trim() };
  }
  if (/^https?:\/\//i.test(href)) return { kind: 'web', text: href, href: href.trim() };
  return null;
}
