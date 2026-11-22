import { useState } from 'react';
import type { PasswordOutcome } from '../../ports/sync.ts';
import { t } from '../i18n/i18n.ts';
import { intlLocale } from '../../core/intl.ts';
import { clockIs24 } from '../format.ts';

/** What a password change asks for: the current password, the new one, and the new one again. */
export function usePasswordDraft() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  // Said once both are as long as each other, not at the first letter.
  const mismatch = again.length >= next.length && again.length > 0 && again !== next;
  return { current, next, again, mismatch, setCurrent, setNext, setAgain };
}

export type PasswordDraft = ReturnType<typeof usePasswordDraft>;

/** "Too many tries" with when the lock ends, at sign-in or confirming a password. */
export function lockedProblem(until: string): string {
  const date = new Date(until);
  const time = Number.isNaN(date.getTime())
    ? until
    : date.toLocaleTimeString(intlLocale(), {
        hour: 'numeric',
        minute: '2-digit',
        hour12: !clockIs24(),
      });
  return t('auth.locked', { time });
}

/** What to tell the person when the server refused the change; null when it went through. */
export function passwordProblem(outcome: PasswordOutcome): string | null {
  switch (outcome.kind) {
    case 'ok':
      return null;
    case 'wrong-password':
      return t('auth.wrongPassword');
    case 'too-short':
      return t('auth.tooShort');
    case 'too-long':
      return t('auth.tooLong');
    case 'demo-account':
      return t('auth.demoAccount');
    case 'locked':
      return lockedProblem(outcome.until);
    default:
      return t('auth.unchanged');
  }
}
