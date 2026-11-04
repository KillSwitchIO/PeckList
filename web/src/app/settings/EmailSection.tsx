import { Alert, Box, Button, TextField } from '@mui/material';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { messageOf } from '../../core/errors.ts';
import type { AccountEmail } from '../../ports/sync.ts';
import { t } from '../i18n/i18n.ts';
import { ProblemAlert } from '../layout/ProblemAlert.tsx';
import { useSyncState } from '../sync/syncContext.ts';
import { Section, SettingRow } from './settingsLayout.tsx';

const OUTCOMES = ['confirmed', 'expired'] as const;
type Outcome = (typeof OUTCOMES)[number];
const isOutcome = (value: string | null): value is Outcome =>
  OUTCOMES.some((each) => each === value);

/**
 * The account's email (PL-122): where password reset links go once it is confirmed. Servers with
 * accounts that send email only (or when one is already set). The link in the confirmation email
 * comes back to `/settings?email=<outcome>`.
 */
export function EmailSection() {
  const transport = useSyncState((state) => state.transport);
  const hasAccounts = useSyncState(
    (state) => state.phase === 'ready' && state.account?.authMode === 'local',
  );
  const api = hasAccounts ? transport.account : undefined;
  const [current, setCurrent] = useState<AccountEmail | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const [outcome] = useState<Outcome | null>(() => {
    const value = params.get('email');
    return isOutcome(value) ? value : null;
  });

  // The outcome is read once; the address goes back to plain /settings.
  useEffect(() => {
    if (params.has('email')) setParams({}, { replace: true });
  }, [params, setParams]);

  useEffect(() => {
    if (!api?.email) return;
    let live = true;
    api.email().then(
      (answer) => live && setCurrent(answer),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [api]);

  if (!api?.setEmail || !current) return null;
  if (!current.mailWorks && current.email === null) return null;

  const answered = (answer: AccountEmail) => {
    setCurrent(answer);
    if (answer.sent === true && answer.email)
      setNotice(t('settings.email.sent', { email: answer.email }));
    else if (answer.sent === false)
      setProblem(t('settings.email.notSent', { problem: answer.problem ?? '' }));
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!api.setEmail) return;
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      const answer = await api.setEmail(draft.trim());
      if (answer === 'invalid') {
        setProblem(t('settings.email.invalid'));
        return;
      }
      setEditing(false);
      answered(answer);
    } catch (error) {
      setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!api.resendConfirmation) return;
    setProblem(null);
    setNotice(null);
    try {
      answered(await api.resendConfirmation());
    } catch (error) {
      setProblem(messageOf(error));
    }
  };

  const hint = !current.email
    ? t('settings.email.none')
    : current.confirmed
      ? t('settings.email.confirmed')
      : current.mailWorks
        ? t('settings.email.waiting')
        : t('settings.email.noMail');

  return (
    <Section title={t('settings.email')}>
      {outcome && (
        <Alert
          severity={outcome === 'confirmed' ? 'success' : 'error'}
          variant="outlined"
          sx={{ mb: 1 }}
        >
          {t(`settings.email.done.${outcome}`)}
        </Alert>
      )}
      {notice && (
        <Alert severity="success" variant="outlined" sx={{ mb: 1 }} onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      <ProblemAlert problem={problem} sx={{ mb: 1 }} />
      {editing ? (
        <Box
          component="form"
          onSubmit={(event) => void save(event)}
          sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', px: 1, py: 1 }}
        >
          <TextField
            type="email"
            size="small"
            label={t('settings.email.field')}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            autoComplete="email"
            autoFocus
            sx={{ flex: '1 1 16rem' }}
            slotProps={{ htmlInput: { maxLength: 254 } }}
          />
          <Button type="submit" variant="contained" disableElevation disabled={busy}>
            {t('settings.email.save')}
          </Button>
          <Button onClick={() => setEditing(false)}>{t('settings.email.cancel')}</Button>
        </Box>
      ) : (
        <SettingRow label={current.email ?? t('settings.email.empty')} hint={hint}>
          <Box sx={{ display: 'flex', gap: 1 }}>
            {current.email && !current.confirmed && current.mailWorks && (
              <Button size="small" onClick={() => void resend()}>
                {t('settings.email.resend')}
              </Button>
            )}
            <Button
              size="small"
              variant="outlined"
              onClick={() => {
                setDraft(current.email ?? '');
                setProblem(null);
                setNotice(null);
                setEditing(true);
              }}
            >
              {current.email ? t('settings.email.change') : t('settings.email.add')}
            </Button>
          </Box>
        </SettingRow>
      )}
    </Section>
  );
}
