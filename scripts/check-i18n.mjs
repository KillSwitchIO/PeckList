#!/usr/bin/env node
// Checks the string catalogs (PL-148), run by the lint job: `pnpm check:i18n`.
//
// For each catalog folder (English source plus one JSON file per language):
//   1. every message is valid ICU MessageFormat, every plural or select has `other`, and no
//      apostrophe turns a parameter into plain text (ICU reads l'{name} as the text "{name}");
//   2. each translation uses the same parameters as its English message, of the same kind
//      ({name}, plural, select, number...), except that a count may change shape: plain to
//      plural where a language needs forms, plural to plain where it has none;
//   3. a translation has no key English no longer has;
//   4. every English key is used in the source: a literal ('nav.today') anywhere in the code, or
//      the prefix of a key built at run time (`audit.outcome.${x}`, 'serverSettings.' + key);
//   5. how much of each language is translated (a report: a missing key shows English).
// Exits 1 on any error from 1 to 4.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The catalogs, each with the source folders its keys are used from. */
export const CATALOGS = [
  {
    name: 'web',
    folder: 'web/src/app/i18n/locales',
    sources: ['web/src'],
  },
];

// Messages with one of these arguments are read as ICU; the rest only fill {name}, the way the
// web's ICU adapter does (web/src/adapters/icu-message-format.ts).
const ICU_ARGUMENT = /\{\s*\w+\s*,\s*(plural|selectordinal|select|number|date|time)\b/;
const PLAIN_PARAMETER = /\{(\w+)\}/g;
// In ICU an apostrophe before a brace quotes it: l'{name} shows "l{name}". A quoted brace on
// its own ('{') is meant.
const QUOTED_PARAMETER = /(?<!')'\{(?!')/;

export async function loadMessageFormat() {
  const web = createRequire(join(ROOT, 'web/package.json'));
  const entry = web.resolve('intl-messageformat');
  return (await import(pathToFileURL(entry).href)).IntlMessageFormat;
}

// AST element types (@formatjs/icu-messageformat-parser TYPE).
const KIND = { 1: 'text', 2: 'number', 3: 'date', 4: 'time', 5: 'select', 6: 'plural' };

function collect(elements, into) {
  for (const element of elements) {
    if (element.type === 1) into.set(element.value, into.get(element.value) ?? 'text');
    else if (element.type in KIND) {
      const kind =
        element.type === 6 && element.pluralType === 'ordinal'
          ? 'selectordinal'
          : KIND[element.type];
      into.set(element.value, kind);
    }
    if (element.options) {
      for (const option of Object.values(element.options)) collect(option.value, into);
    }
    if (element.children) collect(element.children, into);
  }
  return into;
}

/**
 * The parameters a message takes, as name to kind ("text", "plural", "select", "number"...), or
 * an error saying why it isn't valid.
 */
export function parameters(message, locale, IntlMessageFormat) {
  if (typeof message !== 'string') return { error: 'is not a string' };
  if (!ICU_ARGUMENT.test(message)) {
    return { params: new Map([...message.matchAll(PLAIN_PARAMETER)].map((m) => [m[1], 'text'])) };
  }
  if (QUOTED_PARAMETER.test(message)) {
    return {
      error: "has an apostrophe before a {, which ICU reads as quoting it: write ’ or '' instead",
    };
  }
  try {
    const ast = new IntlMessageFormat(message, locale).getAst();
    return { params: collect(ast, new Map()) };
  } catch (error) {
    return { error: `is not valid ICU (${error.message.split('\n')[0]})` };
  }
}

const describe = (params) =>
  [...params]
    .map(([name, kind]) => (kind === 'text' ? `{${name}}` : `{${name}, ${kind}}`))
    .sort()
    .join(' ') || 'none';

// Counts may change shape between languages: a plain English number ("Show {count} more") may
// get plural forms where a language needs them, and an English plural may be a plain number in a
// language without plurals ("{count}件"). A parameter only becomes a plural when it is a count
// (English uses it as one, or its name says so), since a plural over a name breaks at run time.
// Select, date and time keep their kind.
const NUMERIC = new Set(['text', 'plural', 'selectordinal', 'number']);
const COUNT_NAMES =
  /^(count|n|number|total|done|max|days|hours|minutes|weeks|months|years|left|seconds)$/;

/** Whether a translation takes the parameters English does, each of a kind that can stand for it. */
export function sameParameters(mine, source) {
  if (mine.size !== source.size) return false;
  for (const [name, kind] of source) {
    const theirs = mine.get(name);
    if (theirs === kind) continue;
    if (!NUMERIC.has(kind) || !NUMERIC.has(theirs)) return false;
    if (kind === 'text' && !COUNT_NAMES.test(name)) return false;
  }
  return true;
}

/** Errors in one translation against English: bad ICU, other parameters, keys English lacks. */
export function compareCatalog(english, translated, locale, IntlMessageFormat) {
  const errors = [];
  for (const [key, message] of Object.entries(translated)) {
    if (!(key in english)) {
      errors.push(`${key}: not in English any more`);
      continue;
    }
    const mine = parameters(message, locale, IntlMessageFormat);
    if (mine.error) {
      errors.push(`${key}: ${mine.error}`);
      continue;
    }
    const source = parameters(english[key], 'en', IntlMessageFormat);
    if (source.error) continue; // reported with English itself
    if (!sameParameters(mine.params, source.params)) {
      errors.push(
        `${key}: takes ${describe(mine.params)}, English takes ${describe(source.params)}`,
      );
    }
  }
  return errors;
}

function sourceFiles(folder, found = []) {
  for (const name of readdirSync(folder)) {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) {
      if (name !== 'node_modules' && name !== 'locales') sourceFiles(path, found);
    } else if (/\.(ts|tsx|mts)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      found.push(path);
    }
  }
  return found;
}

/**
 * The keys the source code uses: every quoted literal that looks like a key, and the prefixes of
 * keys built at run time (a template literal or a concatenation that starts with "area.").
 */
export function usedKeys(sources) {
  const literals = new Set();
  const prefixes = new Set();
  for (const text of sources) {
    for (const match of text.matchAll(/(['"`])([A-Za-z][\w-]*(?:\.[\w-]+)+)\1/g))
      literals.add(match[2]);
    for (const match of text.matchAll(/`([A-Za-z][\w-]*(?:\.[\w-]+)*\.)\$\{/g))
      prefixes.add(match[1]);
    for (const match of text.matchAll(/(['"])([A-Za-z][\w-]*(?:\.[\w-]+)*\.)\1\s*\+/g))
      prefixes.add(match[2]);
  }
  return { literals, prefixes };
}

/** English keys nothing in the source uses. */
export function unusedKeys(english, { literals, prefixes }) {
  const starts = [...prefixes];
  return Object.keys(english).filter(
    (key) => !literals.has(key) && !starts.some((prefix) => key.startsWith(prefix)),
  );
}

export async function check({ root = ROOT, catalogs = CATALOGS, log = console.log } = {}) {
  const IntlMessageFormat = await loadMessageFormat();
  let failures = 0;
  const fail = (line) => {
    failures += 1;
    log(`  ${line}`);
  };
  for (const catalog of catalogs) {
    const folder = join(root, catalog.folder);
    const read = (file) => JSON.parse(readFileSync(join(folder, file), 'utf8'));
    const english = read('en.json');
    log(`${catalog.name} (${relative(root, folder)}): ${Object.keys(english).length} English keys`);

    for (const [key, message] of Object.entries(english)) {
      const { error } = parameters(message, 'en', IntlMessageFormat);
      if (error) fail(`en ${key}: ${error}`);
    }

    const texts = catalog.sources.flatMap((source) =>
      sourceFiles(join(root, source)).map((file) => readFileSync(file, 'utf8')),
    );
    const used = usedKeys(texts);
    for (const key of unusedKeys(english, used))
      fail(`en ${key}: not used anywhere in ${catalog.sources.join(', ')}`);
    if (used.prefixes.size > 0)
      log(`  keys built at run time from: ${[...used.prefixes].sort().join(' ')}`);

    for (const file of readdirSync(folder)
      .filter((name) => name.endsWith('.json') && name !== 'en.json')
      .sort()) {
      const locale = file.slice(0, -'.json'.length);
      const translated = read(file);
      for (const error of compareCatalog(english, translated, locale, IntlMessageFormat))
        fail(`${locale} ${error}`);
      const done = Object.keys(translated).filter((key) => key in english).length;
      log(
        `  ${locale}: ${done} of ${Object.keys(english).length} translated (${Math.floor((done * 100) / Object.keys(english).length)}%)`,
      );
    }
  }
  log(
    failures === 0
      ? 'Catalogs OK.'
      : `${failures} problem${failures === 1 ? '' : 's'} in the catalogs.`,
  );
  return failures;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = (await check()) > 0 ? 1 : 0;
}
