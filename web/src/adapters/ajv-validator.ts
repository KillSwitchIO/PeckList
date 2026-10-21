import { Ajv2020 } from 'ajv/dist/2020.js';
import schema from '../../../schema/workspace.schema.json';
import type { SchemaValidator } from '../ports/validator.ts';

export function createAjvValidator(): SchemaValidator {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);
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
