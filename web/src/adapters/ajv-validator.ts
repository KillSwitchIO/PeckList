// Compiled at build time, not in the browser: a Content-Security-Policy then needs no 'unsafe-eval'.
import validate from 'virtual:workspace-validator';
import type { SchemaValidator } from '../ports/validator.ts';

export function createAjvValidator(): SchemaValidator {
  return {
    validate(document) {
      const valid = validate(document);
      const errors = (validate.errors ?? []).map(
        (error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`,
      );
      return { valid, errors };
    },
  };
}
