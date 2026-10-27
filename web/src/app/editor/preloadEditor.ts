// The notes editor (TipTap) is split off the app's first load; this fetches it, once.

let loading: Promise<typeof import('./TiptapEditor.tsx')> | null = null;

export function preloadEditor() {
  return (loading ??= import('./TiptapEditor.tsx'));
}
