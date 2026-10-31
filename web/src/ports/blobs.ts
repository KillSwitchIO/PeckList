/**
 * Files on this device (attachments), each under the lowercase hex SHA-256 of its bytes: what was
 * attached here, and what was downloaded once. Adapters: IndexedDB in the browser, memory in tests.
 * Contract: `adapters/blobs.contract.ts`.
 */
export interface BlobStore {
  get(sha256: string): Promise<Blob | null>;
  put(sha256: string, blob: Blob): Promise<void>;
  has(sha256: string): Promise<boolean>;
  delete(sha256: string): Promise<void>;
  /** Forget every file (signing out: nothing of the person stays on the device). */
  clear(): Promise<void>;
}
