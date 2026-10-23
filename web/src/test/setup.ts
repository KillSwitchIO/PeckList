import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// jsdom has no layout. The notes editor (ProseMirror) asks where things are on screen; answer
// with empty boxes so it can run.
const emptyRect = () => DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
if (typeof document !== 'undefined') {
  document.elementFromPoint ??= () => null;
  Range.prototype.getBoundingClientRect ??= emptyRect;
  Range.prototype.getClientRects ??= emptyRects;
  Element.prototype.getClientRects ??= emptyRects;
}

// Object URLs for attachment thumbnails: jsdom has none, and Node's own takes only Node's Blobs.
if (typeof URL !== 'undefined') {
  URL.createObjectURL = () => 'blob:test';
  URL.revokeObjectURL = () => undefined;
}
