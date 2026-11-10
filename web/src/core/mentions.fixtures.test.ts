// The shared @mention cases (schema/fixtures/mentions/cases.json): the app highlights exactly the
// names the server notifies (audit D3). The server's MentionTests read the same file.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mentionedNames } from './commentText.ts';

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
