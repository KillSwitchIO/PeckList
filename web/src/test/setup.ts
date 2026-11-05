import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// Pages that load on first visit (app/lazyPages.ts) appear a moment after the click; on a busy
// runner with coverage that moment passed findBy's default second, and even 3 s for Settings.
// Only a wait that fails takes the whole time.
configure({ asyncUtilTimeout: process.env.CI ? 15_000 : 3000 });

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
