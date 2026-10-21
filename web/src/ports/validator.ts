export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Validates a document against schema/workspace.schema.json. */
export interface SchemaValidator {
  validate(document: unknown): ValidationResult;
}
