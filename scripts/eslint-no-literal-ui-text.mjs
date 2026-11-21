// ESLint rule pecklist/no-literal-ui-text (PL-148): text people see goes through t(), so it can be
// translated. Flags JSX text with a letter in it, and string literals with a letter in the
// attributes people read or hear (aria-label, title, placeholder, label, alt, helperText...).
// Names and code that are the same in every language go in ALLOWED; example addresses
// (https://id.example.com, pecklist.example.com) and single characters pass on their own.

const LETTER = /\p{L}/u;
const READ_ATTRIBUTES = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'helperText',
  'label',
  'placeholder',
  'title',
]);

/** Text that is the same in every language: product names, HTTP headers, the key format. */
export const ALLOWED = new Set(['PeckList', 'Pocket ID', 'Authorization: Bearer', 'PECKLIST-...']);

const ADDRESS = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/i;

const allowed = (text) => {
  const trimmed = text.trim();
  return (
    !LETTER.test(trimmed) || trimmed.length === 1 || ALLOWED.has(trimmed) || ADDRESS.test(trimmed)
  );
};

/** @type {import('eslint').Rule.RuleModule} */
export const noLiteralUiText = {
  meta: {
    type: 'problem',
    docs: { description: 'Text people see goes through t() so it can be translated (PL-148)' },
    messages: {
      text: 'Put "{{text}}" in locales/en.json and show it with t(), so it can be translated.',
    },
    schema: [],
  },
  create(context) {
    const report = (node, text) =>
      context.report({ node, messageId: 'text', data: { text: text.trim().slice(0, 40) } });
    return {
      JSXText(node) {
        if (!allowed(node.value)) report(node, node.value);
      },
      JSXAttribute(node) {
        const name = node.name.type === 'JSXIdentifier' ? node.name.name : null;
        if (!name || !READ_ATTRIBUTES.has(name) || !node.value) return;
        const value =
          node.value.type === 'Literal'
            ? node.value
            : node.value.type === 'JSXExpressionContainer' &&
                node.value.expression.type === 'Literal'
              ? node.value.expression
              : node.value.type === 'JSXExpressionContainer' &&
                  node.value.expression.type === 'TemplateLiteral' &&
                  node.value.expression.expressions.length === 0
                ? { value: node.value.expression.quasis[0]?.value.cooked ?? '' }
                : null;
        if (value && typeof value.value === 'string' && !allowed(value.value)) {
          report(node, value.value);
        }
      },
    };
  },
};
