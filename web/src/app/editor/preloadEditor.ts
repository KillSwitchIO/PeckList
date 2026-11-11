// The notes editor (TipTap) is split off the app's first load; this fetches it, once.
import { importAgain, loadOnce } from '../loadOnce.ts';

export const preloadEditor = loadOnce(() => importAgain(() => import('./TiptapEditor.tsx')));
