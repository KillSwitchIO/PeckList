/** The app's version, stamped at build time (vite.config.ts). */
declare const __APP_VERSION__: string;
/** The commit it was built from (7 characters), or empty. */
declare const __APP_REVISION__: string;

/** The workspace schema's validator, compiled at build time (workspace-validator.ts). */
declare module 'virtual:workspace-validator' {
  import type { ErrorObject } from 'ajv';
  const validate: { (data: unknown): boolean; errors?: ErrorObject[] | null };
  export default validate;
}
