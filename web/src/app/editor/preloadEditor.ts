// The notes editor (TipTap) is split off the app's first load; this fetches it, once.
import { loadOnce } from '../loadOnce.ts';

export const preloadEditor = loadOnce(() => import('./TiptapEditor.tsx'));
