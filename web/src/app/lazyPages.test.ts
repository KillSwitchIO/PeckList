import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Every page split off the first load goes through importAgain, so one that could not be fetched is
// asked for again by a new address on the next visit. A page added later with a bare import() would
// stay broken until a reload in a browser that keeps the failure.
describe('the pages that load on first visit', () => {
  const source = readFileSync('src/app/lazyPages.ts', 'utf8');
  const pages = [...source.matchAll(/export const (\w+) = lazyPage\(\(\) =>([\s\S]*?)\n\);/g)];

  it('are all found', () => {
    expect(pages.length).toBeGreaterThanOrEqual(11);
  });

  it.each(pages.map(([, name, body]) => [name, body] as const))(
    '%s is fetched again after a failure',
    (_, body) => {
      expect(body).toMatch(/^\s*importAgain\(\(\) => import\(/);
    },
  );
});
