// The shared @mention cases (schema/fixtures/mentions/cases.json): the app highlights exactly the
// names the server notifies (audit D3). The server's MentionTests read the same file.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mentionedNames } from './commentText.ts';
import { mentionAt } from './comments.ts';

const FILE = resolve(process.cwd(), '../schema/fixtures/mentions/cases.json');
const { cases } = JSON.parse(readFileSync(FILE, 'utf8')) as {
  cases: { body: string; names: string[] }[];
};

describe('@mentions, as the server reads them (audit D3)', () => {
  it('has the shared cases', () => {
    expect(cases.length).toBeGreaterThan(20);
  });

  it.each(cases.map((each) => [JSON.stringify(each.body), each] as const))(
    '%s',
    (_, { body, names }) => {
      expect(mentionedNames(body)).toEqual(names);
    },
  );
});

// The mention picker opens exactly where the reader counts a name: typing each case from the start,
// the picker shows each name the server notifies, in order, and no other.
describe('the mention picker, against the same cases', () => {
  // What would carry the name on: more letters or digits, maybe after dots, dashes or underscores.
  const goesOn = /^[._-]*[\p{L}\p{N}]/u;
  it.each(cases.map((each) => [JSON.stringify(each.body), each] as const))(
    '%s',
    (_, { body, names }) => {
      const offered: string[] = [];
      for (let caret = 1; caret <= body.length; caret++) {
        const typing = mentionAt(body, caret);
        // A whole name: the caret at its end, and the name not ending in a mark.
        const whole = typing && /[\p{L}\p{N}]$/u.test(typing.query);
        if (whole && !goesOn.test(body.slice(caret))) {
          offered.push(typing.query);
        }
      }
      expect(offered).toEqual(names);
    },
  );
});
