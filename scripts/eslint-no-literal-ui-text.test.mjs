import { RuleTester } from 'eslint';
import { after, describe, it } from 'node:test';
import tseslint from 'typescript-eslint';
import { noLiteralUiText } from './eslint-no-literal-ui-text.mjs';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;
RuleTester.afterAll = after;

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const error = (text) => ({ messageId: 'text', data: { text } });

tester.run('no-literal-ui-text', noLiteralUiText, {
  valid: [
    "<p>{t('nav.today')}</p>",
    "<Button aria-label={t('task.add')} title={label} />",
    '<span> · </span>',
    '<span>{count} / 10</span>',
    '<Box>PeckList</Box>',
    '<TextField placeholder="Pocket ID" />',
    '<TextField placeholder="https://id.example.com" />',
    '<TextField placeholder="pecklist.example.com:8080" />',
    '<span>z</span>',
    '<code>Authorization: Bearer</code>',
    // Attributes no one reads aren't text: test ids, class names, routes.
    '<div data-testid="Task row" className="Task row" />',
    '<Route path="/today" />',
  ],
  invalid: [
    { code: '<p>Nothing on this day yet.</p>', errors: [error('Nothing on this day yet.')] },
    { code: '<Button aria-label="Add a task" />', errors: [error('Add a task')] },
    { code: '<Tooltip title={"Filter"} />', errors: [error('Filter')] },
    { code: '<TextField label={`Notes`} />', errors: [error('Notes')] },
    {
      code: '<TextField helperText="At least 8 characters" />',
      errors: [error('At least 8 characters')],
    },
    { code: '<img alt="Bird" />', errors: [error('Bird')] },
    { code: '<span>Prüfen</span>', errors: [error('Prüfen')] },
  ],
});
