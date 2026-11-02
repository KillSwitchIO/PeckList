import { createContext } from 'react';

/**
 * The one day a page is about (the day page's date), so its rows need not repeat it: a row on
 * that day shows only its time, or nothing when it is all day (PL-094). Null everywhere else.
 */
export const PageDay = createContext<string | null>(null);
