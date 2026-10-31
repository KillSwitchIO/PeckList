import { describe, expect, it } from 'vitest';
import { escapeMarkdownText, linkHref, roundTripMarkdown } from './tiptapMarkdown.ts';

describe('notes markdown round trip', () => {
  it.each([
    ['plain lines', 'call the vet\nask about the shots'],
    ['paragraphs', 'first thought\n\nsecond thought'],
    ['marks', '**bold**, *italic*, ~~gone~~ and `code`'],
    ['headings', '# Plan\n\n## Steps\n\nText'],
    ['bullets', '- posts\n- concrete\n  - two bags'],
    ['numbers', '1. dig\n2. set'],
    ['checklist', '- [ ] buy posts\n- [x] mark holes'],
    ['link', 'see [the guide](https://example.com/fence)'],
    ['quote', '> measure twice'],
    ['code block', '```\nnpm run dev\n```'],
    ['plain symbols', '2 < 3 & 4 > 1, salt & pepper, 5 * 2'],
    ['words with underscores', 'rename snake_case_name'],
    ['windows path', String.raw`C:\Users\me\notes`],
    ['lone brackets', 'see [1] and [draft]'],
    ['empty', ''],
  ])('keeps %s exactly', (_, markdown) => {
    expect(roundTripMarkdown(markdown)).toBe(markdown);
  });

  it('keeps literal syntax characters literal', () => {
    for (const text of ['*not italic*', '`not code`', '<b>not html</b>', '&amp;', '[x](y)']) {
      const escaped = escapeMarkdownText(text);
      expect(escaped).not.toBe(text);
      // Parsing the escaped form gives the literal text back.
      expect(roundTripMarkdown(escaped)).toBe(escaped);
    }
  });
});

describe('link addresses', () => {
  it('adds https to a bare address and keeps ones with a scheme', () => {
    expect(linkHref(' example.com/ladders ')).toBe('https://example.com/ladders');
    expect(linkHref('http://intranet.test')).toBe('http://intranet.test');
    expect(linkHref('mailto:me@example.com')).toBe('mailto:me@example.com');
    expect(linkHref('   ')).toBeNull();
  });

  it('keeps only web and mail links, typed or synced from someone else (audit W3)', () => {
    expect(linkHref('javascript:alert(1)')).toBeNull();
    expect(linkHref(' JavaScript:alert(1)')).toBeNull();
    expect(linkHref('data:text/html,<script>alert(1)</script>')).toBeNull();
    // A note that arrives with such a link shows its text, not a link.
    const synced = roundTripMarkdown(
      'see [the guide](javascript:alert(1)) and [ok](https://example.com)',
    );
    expect(synced).not.toContain('javascript:');
    expect(synced).toContain('[ok](https://example.com)');
  });
});
