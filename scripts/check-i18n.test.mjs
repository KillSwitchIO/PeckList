import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import {
  check,
  compareCatalog,
  loadMessageFormat,
  parameters,
  unusedKeys,
  usedKeys,
} from './check-i18n.mjs';

const IntlMessageFormat = await loadMessageFormat();
const params = (message, locale = 'en') => {
  const result = parameters(message, locale, IntlMessageFormat);
  return result.error ?? Object.fromEntries(result.params);
};

test('reads plain {name} parameters and ICU arguments by kind', () => {
  assert.deepEqual(params('Will be saved as {path}'), { path: 'text' });
  assert.deepEqual(params("Can't reach your server"), {});
  assert.deepEqual(params('{name} added {count, plural, one {# task in {list}} other {# tasks}}'), {
    name: 'text',
    count: 'plural',
    list: 'text',
  });
  assert.deepEqual(params('{kind, select, list {A list} other {Other}}'), { kind: 'select' });
  assert.deepEqual(params('{n, selectordinal, one {#st} other {#th}}'), { n: 'selectordinal' });
});

test('says why a message is not valid ICU', () => {
  assert.match(params('{count, plural, one {# task}'), /not valid ICU/);
  assert.match(params('{count, plural, one {# task}}'), /not valid ICU/); // no `other`
  assert.match(String(parameters(3, 'en', IntlMessageFormat).error), /not a string/);
});

test('fails an apostrophe that quotes a parameter in an ICU message, not in a plain one', () => {
  assert.match(
    params("{count, plural, one {l'{name} et # tâche} other {l'{name} et # tâches}}", 'fr'),
    /apostrophe before a \{/,
  );
  assert.deepEqual(params("{count, plural, one {l’{name}} other {l''{name}}}", 'fr'), {
    count: 'plural',
    name: 'text',
  });
  assert.deepEqual(params("{count, plural, other {'{'#'}'}}"), { count: 'plural' });
  // Plain messages only fill {name}, so an apostrophe there is just text.
  assert.deepEqual(params("Ouvrir l'{list}", 'fr'), { list: 'text' });
});

test('fails a translation with other parameters, other kinds, or a key English lacks', () => {
  const english = {
    'tag.preview': 'Will be saved as {path}',
    'tasks.showMore': '{count, plural, one {Show # more} other {Show # more}}',
    'nav.today': 'Today',
  };
  const errors = compareCatalog(
    english,
    {
      'tag.preview': 'Wird als {pfad} gespeichert',
      'tasks.showMore': '{count} weitere zeigen',
      'nav.today': 'Heute',
      'nav.gone': 'Weg',
    },
    'de',
    IntlMessageFormat,
  );
  assert.deepEqual(errors, [
    'tag.preview: takes {pfad}, English takes {path}',
    'tasks.showMore: takes {count}, English takes {count, plural}',
    'nav.gone: not in English any more',
  ]);
});

test('passes a translation with the same parameters, whatever its plural branches', () => {
  const english = { 'tasks.showMore': '{count, plural, one {Show # more} other {Show # more}}' };
  const polish = {
    'tasks.showMore':
      '{count, plural, one {# więcej} few {# więcej} many {# więcej} other {# więcej}}',
  };
  assert.deepEqual(compareCatalog(english, polish, 'pl', IntlMessageFormat), []);
});

test('finds keys used as literals and prefixes of keys built at run time', () => {
  const used = usedKeys([
    't(\'nav.today\'); const label = "list.sort.title";',
    't(`audit.outcome.${entry.outcome}` as MessageKey)',
    "t(('serverSettings.' + key) as MessageKey)",
  ]);
  assert.ok(used.literals.has('nav.today'));
  assert.ok(used.literals.has('list.sort.title'));
  assert.deepEqual([...used.prefixes].sort(), ['audit.outcome.', 'serverSettings.']);
  const english = {
    'nav.today': '',
    'list.sort.title': '',
    'audit.outcome.ok': '',
    'serverSettings.smtp': '',
    'theme.toggle': '',
  };
  assert.deepEqual(unusedKeys(english, used), ['theme.toggle']);
});

const root = mkdtempSync(join(tmpdir(), 'check-i18n-'));
after(() => rmSync(root, { recursive: true, force: true }));

function fixture(name, { english, translations = {}, source }) {
  const folder = join(root, name);
  mkdirSync(join(folder, 'locales'), { recursive: true });
  mkdirSync(join(folder, 'src'), { recursive: true });
  writeFileSync(join(folder, 'locales/en.json'), JSON.stringify(english));
  for (const [locale, catalog] of Object.entries(translations)) {
    writeFileSync(join(folder, `locales/${locale}.json`), JSON.stringify(catalog));
  }
  writeFileSync(join(folder, 'src/view.tsx'), source);
  // A test file's keys don't count as used.
  writeFileSync(join(folder, 'src/view.test.tsx'), "t('only.inTests')");
  return { name, folder: `${name}/locales`, sources: [`${name}/src`] };
}

test('passes good catalogs and reports how much of each language is done', async () => {
  const lines = [];
  const catalog = fixture('good', {
    english: { 'nav.today': 'Today', 'nav.inbox': 'Mess Drawer' },
    translations: { de: { 'nav.today': 'Heute' } },
    source: "t('nav.today'); t('nav.inbox');",
  });
  const failures = await check({ root, catalogs: [catalog], log: (line) => lines.push(line) });
  assert.equal(failures, 0);
  assert.ok(lines.includes('  de: 1 of 2 translated (50%)'), lines.join('\n'));
  assert.equal(lines.at(-1), 'Catalogs OK.');
});

test('counts every problem: bad English ICU, unused keys, a broken translation', async () => {
  const lines = [];
  const catalog = fixture('bad', {
    english: {
      'nav.today': 'Today',
      'tasks.count': '{count, plural, one {# task}}',
      'only.inTests': 'Unused',
    },
    translations: { fr: { 'nav.today': "Aujourd'hui {jour}" } },
    source: "t('nav.today'); t('tasks.count');",
  });
  const failures = await check({ root, catalogs: [catalog], log: (line) => lines.push(line) });
  assert.equal(failures, 3, lines.join('\n'));
  assert.match(lines.join('\n'), /en tasks\.count: is not valid ICU/);
  assert.match(lines.join('\n'), /en only\.inTests: not used anywhere/);
  assert.match(lines.join('\n'), /fr nav\.today: takes \{jour\}, English takes none/);
  assert.equal(lines.at(-1), '3 problems in the catalogs.');
});
