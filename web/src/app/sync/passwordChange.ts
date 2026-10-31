import { useState } from 'react';
import type { PasswordOutcome } from '../../ports/sync.ts';
import { t } from '../i18n/i18n.ts';

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

/** What to tell the person when the server refused the change; null when it went through. */
export function passwordProblem(outcome: PasswordOutcome): string | null {
  switch (outcome.kind) {
    case 'ok':
      return null;
    case 'wrong-password':
      return t('auth.wrongPassword');
    case 'too-short':
      return t('auth.tooShort');
    case 'demo-account':
      return t('auth.demoAccount');
    default:
      return t('auth.unchanged');
  }
}
