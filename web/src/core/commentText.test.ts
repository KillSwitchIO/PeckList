import { describe, expect, it } from 'vitest';
import { commentParagraphs, inline } from './commentText.ts';

describe('comment text', () => {
  it('reads bold, italic, code, links and mentions', () => {
    expect(inline('**Bold** and *it* and _it_ with `x = 1`')).toEqual([
      { kind: 'bold', children: [{ kind: 'text', text: 'Bold' }] },
      { kind: 'text', text: ' and ' },
      { kind: 'italic', children: [{ kind: 'text', text: 'it' }] },
      { kind: 'text', text: ' and ' },
      { kind: 'italic', children: [{ kind: 'text', text: 'it' }] },
      { kind: 'text', text: ' with ' },
      { kind: 'code', text: 'x = 1' },
    ]);
    expect(inline('See [the plan](https://example.com/plan) or https://example.com/x.')).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'link', text: 'the plan', href: 'https://example.com/plan' },
      { kind: 'text', text: ' or ' },
      { kind: 'link', text: 'https://example.com/x', href: 'https://example.com/x' },
      { kind: 'text', text: '.' },
    ]);
    expect(inline('Thanks @sam.lee, mail me@home')).toEqual([
      { kind: 'text', text: 'Thanks ' },
      { kind: 'mention', name: 'sam.lee' },
      { kind: 'text', text: ', mail me@home' },
    ]);
  });

  it('never links anything but web and mail addresses', () => {
    expect(inline('[click](javascript:alert(1))')).toEqual([
      { kind: 'text', text: '[click](javascript:alert(1))' },
    ]);
    expect(inline('<b>hi</b>')).toEqual([{ kind: 'text', text: '<b>hi</b>' }]);
  });

  it('splits paragraphs at blank lines and keeps single line breaks', () => {
    expect(commentParagraphs('One\nline\n\nTwo')).toEqual([
      [{ kind: 'text', text: 'One' }, { kind: 'break' }, { kind: 'text', text: 'line' }],
      [{ kind: 'text', text: 'Two' }],
    ]);
    expect(inline('snake_case_name')).toEqual([{ kind: 'text', text: 'snake_case_name' }]);
    expect(inline('hi @b!')).toEqual([
      { kind: 'text', text: 'hi ' },
      { kind: 'mention', name: 'b' },
      { kind: 'text', text: '!' },
    ]);
  });
});
