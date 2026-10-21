import type { ReactNode } from 'react';
import { ThemeModeProvider } from './theme/ThemeModeProvider.tsx';

/** Providers shared by the real app and tests. */
export function AppProviders({ children }: { children: ReactNode }) {
  return <ThemeModeProvider>{children}</ThemeModeProvider>;
}
