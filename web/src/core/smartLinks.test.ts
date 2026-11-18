import { describe, expect, it } from 'vitest';
import {
  appleMapsHref,
  findSmartLinks,
  geoHref,
  googleMapsHref,
  linkAsSmart,
  mailHref,
  openable,
  openStreetMapHref,
  phoneNumber,
  smsHref,
  telHref,
  webHref,
} from './smartLinks.ts';

const found = (text: string) => findSmartLinks(text).map(({ kind, text }) => [kind, text]);

describe('smart links: what is found', () => {
  it('finds web addresses, without the sentence punctuation around them', () => {
    expect(found('See https://example.com/a?b=1. Or (www.example.org/x), then.')).toEqual([
      ['web', 'https://example.com/a?b=1'],
      ['web', 'www.example.org/x'],
    ]);
    expect(found('https://en.wikipedia.org/wiki/Foo_(bar) is it')).toEqual([
      ['web', 'https://en.wikipedia.org/wiki/Foo_(bar)'],
    ]);
  });

  it('finds email addresses', () => {
    expect(found('Write to sam.o+lists@mail.example.co.uk, or ask.')).toEqual([
      ['email', 'sam.o+lists@mail.example.co.uk'],
    ]);
  });

  it('finds phone numbers with a country code or in the North American shape', () => {
    expect(
      found(
        'Call (515) 555-0123 or 515-555-0199, 1 515.555.0142, +44 20 7946 0958, +1 (515) 555-0100, +4930123456.',
      ),
    ).toEqual([
      ['phone', '(515) 555-0123'],
      ['phone', '515-555-0199'],
      ['phone', '1 515.555.0142'],
      ['phone', '+44 20 7946 0958'],
      ['phone', '+1 (515) 555-0100'],
      ['phone', '+4930123456'],
    ]);
  });

  it('finds street addresses with a house number, a street name and a street word', () => {
    expect(found('Pick up at 123 Main St, Urbandale, IA 50322 after 5')).toEqual([
      ['address', '123 Main St, Urbandale, IA 50322'],
    ]);
    expect(found('1600 Pennsylvania Avenue NW, Washington, DC 20500')).toEqual([
      ['address', '1600 Pennsylvania Avenue NW, Washington, DC 20500'],
    ]);
    expect(found('Party at 42 W 5th Ave Apt 3B on Friday')).toEqual([
      ['address', '42 W 5th Ave Apt 3B'],
    ]);
    expect(found('10 Downing Street')).toEqual([['address', '10 Downing Street']]);
    expect(found('Drop off: 8 Oak Dr.')).toEqual([['address', '8 Oak Dr.']]);
  });

  it('keeps the town only when a state or ZIP code follows it', () => {
    expect(found('123 Main St, Buy milk')).toEqual([['address', '123 Main St']]);
  });

  it('tells one kind from another where they touch', () => {
    expect(found('https://example.com/call/515-555-0123 and me@example.com')).toEqual([
      ['web', 'https://example.com/call/515-555-0123'],
      ['email', 'me@example.com'],
    ]);
  });
});

describe('smart links: what is left as text', () => {
  it.each([
    ['a date', 'Due 2026-11-17, or 11/17/2026'],
    ['a time range', 'Open 9:00-17:00'],
    ['an order number', 'Order 5155550123 shipped'],
    ['a longer number', 'Part 515-555-0123-44'],
    ['a number in a word', 'SKU A515-555-0123'],
    ['a short number', 'Call 555-0123'],
    ['too few digits with a plus', '+1 23'],
    ['a version', 'Version 1.2.3 and v10.4'],
    ['a sum', '2 + 3 = 5'],
    ['an amount', 'Spent $123 on Main Street things'],
    ['no street word', 'Buy 2 Big Macs'],
    ['a lowercase name', 'Ran 5 miles down the road'],
    ['a doctor', 'Take 3 Tylenol Dr said so'],
    ['a bare domain', 'example.com is down'],
    ['www alone', 'www. is a prefix'],
    ['a handle', 'Ping @sam on chat'],
    ['an @ with no domain', 'mail@home'],
    ['a scheme that is not web', 'javascript:alert(1) and ftp://example.com'],
  ])('%s', (_name, text) => {
    expect(found(text)).toEqual([]);
  });
});

describe('smart links: long and awkward text', () => {
  it('takes brackets off a web address in linear time (no freeze on a run of them)', () => {
    const text = `http://a${')'.repeat(50_000)}`;
    const started = performance.now();
    expect(findSmartLinks(text)).toEqual([{ kind: 'web', from: 0, to: 8, text: 'http://a' }]);
    expect(performance.now() - started).toBeLessThan(250);
    expect(findSmartLinks('(see https://en.wikipedia.org/wiki/A_(B)).')[0]?.text).toBe(
      'https://en.wikipedia.org/wiki/A_(B)',
    );
  });

  it('stops a web address at a hard break, code or a link, and at a CJK stop', () => {
    expect(findSmartLinks('see www.example.com\u0000next line')[0]?.text).toBe('www.example.com');
    expect(findSmartLinks('https://example.com/\u3002\u6b21')[0]?.text).toBe(
      'https://example.com/',
    );
  });

  it('trims extra groups off an international number, and leaves lists alone', () => {
    const phone = (text: string) => findSmartLinks(text).find((each) => each.kind === 'phone');
    expect(phone('Call +44 20 7946 0958 2 times')?.text).toBe('+44 20 7946 0958');
    expect(phone('Call +1 515 555 0123 10am')?.text).toBe('+1 515 555 0123');
    expect(phone('Sets: +10 15 20 25 30')).toBeUndefined();
    expect(phone('+44 (0)20 7946 0958')?.text).toBe('+44 (0)20 7946 0958');
    expect(phoneNumber('+44 (0)20 7946 0958')).toBe('+442079460958');
  });

  it('finds no email with an encoded character before the @, and encodes what it writes to', () => {
    expect(findSmartLinks('a%3Fbcc@example.com').map((each) => each.text)).not.toContain(
      'a%3Fbcc@example.com',
    );
    expect(mailHref('sam+lists@example.com')).toBe('mailto:sam+lists@example.com');
    expect(mailHref('a?b&c#d e%')).toBe('mailto:a%3Fb%26c%23d%20e%25');
  });
});

describe('smart links: where each opens', () => {
  it('opens only web, mail, dialer, text and maps addresses', () => {
    for (const href of [
      'https://a.example',
      'http://a.example',
      'mailto:a@b.example',
      'tel:+15155550123',
      'sms:+15155550123',
      'geo:0,0?q=x',
    ]) {
      expect(openable(href)).toBe(true);
    }
    for (const href of [
      'javascript:alert(1)',
      'data:text/html,x',
      'intent://x#Intent;end',
      'file:///etc/passwd',
      'ftp://a.example',
      'vbscript:x',
      '//a.example',
    ]) {
      expect(openable(href)).toBe(false);
    }
  });

  it('builds the addresses each choice opens', () => {
    expect(webHref('www.example.com')).toBe('https://www.example.com');
    expect(webHref('http://example.com')).toBe('http://example.com');
    expect(telHref('+1 (515) 555-0100')).toBe('tel:+15155550100');
    expect(smsHref('515-555-0199')).toBe('sms:5155550199');
    const address = '123 Main St,\nUrbandale, IA 50322';
    const query = encodeURIComponent('123 Main St, Urbandale, IA 50322');
    expect(geoHref(address)).toBe(`geo:0,0?q=${query}`);
    expect(googleMapsHref(address)).toBe(
      `https://www.google.com/maps/search/?api=1&query=${query}`,
    );
    expect(appleMapsHref(address)).toBe(`https://maps.apple.com/?q=${query}`);
    expect(openStreetMapHref(address)).toBe(`https://www.openstreetmap.org/search?query=${query}`);
  });

  it('reads a link already in the notes as web or email, and nothing else', () => {
    expect(linkAsSmart('mailto:sam%40x@example.com?subject=Hi')).toEqual({
      kind: 'email',
      text: 'sam@x@example.com',
      href: 'mailto:sam%40x@example.com?subject=Hi',
    });
    expect(linkAsSmart('https://example.com')).toEqual({
      kind: 'web',
      text: 'https://example.com',
      href: 'https://example.com',
    });
    // An encoded ?bcc= stays encoded where it opens, and out of what is copied.
    const sneaky = 'mailto:support%40bank.com%3Fbcc%3Dattacker%40evil.com';
    expect(linkAsSmart(sneaky)).toEqual({ kind: 'email', text: 'support@bank.com', href: sneaky });
    expect(linkAsSmart('javascript:alert(1)')).toBeNull();
    expect(linkAsSmart('tel:123')).toBeNull();
  });
});
