// Port: turns one catalog message and its parameters into the text people see (PL-148). The
// message syntax is ICU MessageFormat: `{name}` fills a parameter, and
// `{count, plural, one {# task} other {# tasks}}` picks the form a language's plural rules ask
// for. Any adapter must pass messageFormat.contract.ts.

export type MessageParams = Record<string, string | number>;

export interface MessageFormatter {
  /**
   * The message with its parameters filled in, in `locale`'s plural rules and number style.
   * Never throws: a parameter not given stays as `{name}`, and a message it cannot read comes
   * back with only its plain `{name}` parameters filled, so a bad translation never breaks a page.
   */
  format(message: string, params: MessageParams, locale: string): string;
}
