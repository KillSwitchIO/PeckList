import { createContext } from 'react';

/** The header slot inside the persistent AppShell that pages render their title into. */
export const HeaderSlotContext = createContext<HTMLElement | null>(null);
