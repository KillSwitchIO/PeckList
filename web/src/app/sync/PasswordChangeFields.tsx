import { t } from '../i18n/i18n.ts';
import { PasswordField } from '../layout/PasswordField.tsx';
import type { PasswordDraft } from './passwordChange.ts';

/** The three fields of a password change, the first focused. */
export function PasswordChangeFields({ draft }: { draft: PasswordDraft }) {
  return (
    <>
      <PasswordField
        label={t('auth.current')}
        value={draft.current}
        onChange={(event) => draft.setCurrent(event.target.value)}
        autoComplete="current-password"
        autoFocus
        required
      />
      <PasswordField
        label={t('auth.new')}
        value={draft.next}
        onChange={(event) => draft.setNext(event.target.value)}
        autoComplete="new-password"
        helperText={t('auth.newHint')}
        required
      />
      <PasswordField
        label={t('auth.confirmNew')}
        value={draft.again}
        onChange={(event) => draft.setAgain(event.target.value)}
        autoComplete="new-password"
        error={draft.mismatch}
        helperText={draft.mismatch ? t('auth.mismatch') : undefined}
        required
      />
    </>
  );
}
