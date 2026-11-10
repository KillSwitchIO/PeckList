// The small markdown comments use, as tokens to render without HTML: paragraphs and line breaks,
// **bold**, *italic* or _italic_, `code`, [links](https://...), bare https:// links and @mentions.

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold' | 'italic'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string }
  | { kind: 'mention'; name: string }
  | { kind: 'break' };

/** Only web and mail links are followed; anything else stays text. */
function safeHref(href: string): string | null {
  return /^(https?:\/\/|mailto:)/i.test(href) ? href : null;
}

/** `atWordStart`: only where a word begins (`mail@home` is no mention, `snake_case` no italic). */
const RULES: {
  pattern: RegExp;
  make: (match: RegExpExecArray) => Inline | null;
  atWordStart?: boolean;
}[] = [
  { pattern: /`([^`\n]+)`/y, make: (m) => ({ kind: 'code', text: m[1]! }) },
  {
    pattern: /\[([^\]\n]+)\]\(([^)\s]+)\)/y,
    make: (m) => {
      const href = safeHref(m[2]!);
      return href ? { kind: 'link', text: m[1]!, href } : null;
    },
  },
  {
    pattern: /\*\*(?=\S)([^\n]*?\S)\*\*/y,
    make: (m) => ({ kind: 'bold', children: inline(m[1]!) }),
  },
  {
    pattern: /\*(?=\S)([^*\n]*?\S)\*/y,
    make: (m) => ({ kind: 'italic', children: inline(m[1]!) }),
  },
  {
    pattern: /_(?=\S)([^_\n]*?\S)_(?![\p{L}\p{N}])/uy,
    make: (m) => ({ kind: 'italic', children: inline(m[1]!) }),
    atWordStart: true,
  },
  {
    pattern: /https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/y,
    make: (m) => ({ kind: 'link', text: m[0], href: m[0] }),
    atWordStart: true,
  },
  {
    pattern: /@([\p{L}\p{N}](?:[\p{L}\p{N}._-]*[\p{L}\p{N}])?)/uy,
    make: (m) => ({ kind: 'mention', name: m[1]! }),
    atWordStart: true,
  },
];

/** Inline tokens of one paragraph; single line breaks are kept. */
export function inline(text: string): Inline[] {
  const out: Inline[] = [];
  let plain = '';
  const flush = () => {
    if (plain) out.push({ kind: 'text', text: plain });
    plain = '';
  };
  let at = 0;
  outer: while (at < text.length) {
    const char = text[at]!;
    if (char === '\n') {
      flush();
      out.push({ kind: 'break' });
      at += 1;
      continue;
    }
    const wordStart = at === 0 || /[\s(]/.test(text[at - 1]!);
    for (const rule of RULES) {
      if (rule.atWordStart && !wordStart) continue;
      rule.pattern.lastIndex = at;
      const match = rule.pattern.exec(text);
      if (!match) continue;
      const token = rule.make(match);
      if (!token) continue;
      flush();
      out.push(token);
      at += match[0].length;
      continue outer;
    }
    plain += char;
    at += 1;
  }
  flush();
  return out;
}

/** Paragraphs (split at blank lines), each as inline tokens. */
export function commentParagraphs(body: string): Inline[][] {
  return body
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map(inline);
}

/**
 * The names a comment @mentions, in order (repeats kept), as the comment shows them: not in
 * `code` or a link's label, and inside bold and italic. The server reads mentions the same way
 * to notify (audit D3); schema/fixtures/mentions/cases.json pins both sides.
 */
export function mentionedNames(body: string): string[] {
  const names: string[] = [];
  const walk = (tokens: readonly Inline[]) => {
    for (const token of tokens) {
      if (token.kind === 'mention') names.push(token.name);
      else if (token.kind === 'bold' || token.kind === 'italic') walk(token.children);
    }
  };
  for (const paragraph of commentParagraphs(body)) walk(paragraph);
  return names;
}
