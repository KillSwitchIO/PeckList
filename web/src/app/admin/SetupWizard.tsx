import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  Radio,
  RadioGroup,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { AdminApi, ServerSetting, ServerSettingsView } from '../../ports/admin.ts';
import { t } from '../i18n/i18n.ts';
import { PasswordField } from '../layout/PasswordField.tsx';

const STEPS = ['address', 'provider', 'join'] as const;
type Step = (typeof STEPS)[number];
const STEP_KEY = 'punchlist.setup.step';

function savedStep(): number {
  try {
    const index = Number(localStorage.getItem(STEP_KEY));
    return Number.isInteger(index) && index >= 0 && index < STEPS.length ? index : 0;
  } catch {
    return 0;
  }
}

function rememberStep(index: number | null) {
  try {
    if (index === null) localStorage.removeItem(STEP_KEY);
    else localStorage.setItem(STEP_KEY, String(index));
  } catch {
    // Without storage the wizard starts at the beginning next time; nothing is lost on the server.
  }
}

const find = (view: ServerSettingsView, key: string): ServerSetting | undefined =>
  view.settings.find((setting) => setting.key === key);

/** Lowercase letters, digits and dashes, as provider names must be. */
const providerName = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);

/**
 * The first-run wizard (spec: First-run wizard): after the first admin has chosen a password, the
 * public address, an identity provider if wanted, and who can join. Each step saves through the
 * settings page's own checks, so leaving halfway loses nothing and the wizard resumes where it was.
 */
export function SetupWizard({ api }: { api: AdminApi }) {
  const navigate = useNavigate();
  const [view, setView] = useState<ServerSettingsView | null>(null);
  const [step, setStep] = useState(savedStep);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [address, setAddress] = useState('');
  const [provider, setProvider] = useState({
    label: '',
    authority: '',
    clientId: '',
    clientSecret: '',
    autoCreate: true,
  });
  const [join, setJoin] = useState('invite');

  useEffect(() => {
    let live = true;
    void Promise.all([api.setup(), api.settings()]).then(([state, settings]) => {
      if (!live) return;
      // Already set up: nothing to do here.
      if (state.done) {
        rememberStep(null);
        void navigate('/admin', { replace: true });
        return;
      }
      setView(settings);
      setAddress(find(settings, 'PUBLIC_URL')?.value ?? window.location.origin);
      setJoin(find(settings, 'REGISTRATION')?.value ?? 'invite');
    });
    return () => {
      live = false;
    };
  }, [api, navigate]);

  if (!view) return null;
  const current: Step = STEPS[step]!;
  const addressSetting = find(view, 'PUBLIC_URL');
  const providers = find(view, 'OIDC_PROVIDERS');
  const joinSetting = find(view, 'REGISTRATION');
  const name = providerName(provider.label);
  const base = (addressSetting?.value ?? address).replace(/\/+$/, '');

  const go = (index: number) => {
    setProblem(null);
    setStep(index);
    rememberStep(index);
  };

  const save = async (values: Record<string, string>) => {
    if (Object.keys(values).length === 0) return true;
    setBusy(true);
    const result = await api.saveSettings(values);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return false;
    }
    setView(result.value);
    return true;
  };

  const next = async () => {
    setProblem(null);
    let values: Record<string, string> = {};
    if (current === 'address' && !addressSetting?.locked) values = { PUBLIC_URL: address.trim() };
    if (current === 'provider' && !providers?.locked) {
      const prefix = `OIDC_${name.toUpperCase().replace(/-/g, '_')}_`;
      const existing = (providers?.value ?? '')
        .split(',')
        .map((each) => each.trim())
        .filter(Boolean);
      values = {
        OIDC_PROVIDERS: [...new Set([...existing, name])].join(','),
        [`${prefix}AUTHORITY`]: provider.authority.trim(),
        [`${prefix}CLIENT_ID`]: provider.clientId.trim(),
        [`${prefix}DISPLAY_NAME`]: provider.label.trim(),
        [`${prefix}AUTO_CREATE`]: provider.autoCreate ? 'true' : 'false',
      };
      if (provider.clientSecret) values[`${prefix}CLIENT_SECRET`] = provider.clientSecret;
    }
    if (current === 'join' && !joinSetting?.locked) values = { REGISTRATION: join };
    if (!(await save(values))) return;
    if (step < STEPS.length - 1) {
      go(step + 1);
      return;
    }
    await api.finishSetup();
    rememberStep(null);
    setFinished(true);
  };

  const notNow = () => {
    rememberStep(step);
    void navigate('/admin');
  };

  if (finished) {
    return (
      <Box sx={{ maxWidth: 560, display: 'grid', gap: 2 }}>
        <Typography variant="h6">{t('setup.doneTitle')}</Typography>
        {view.pendingRestart ? (
          <>
            <Typography color="text.secondary">{t('setup.restartText')}</Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button variant="contained" disableElevation onClick={() => void api.restart()}>
                {t('serverSettings.restart')}
              </Button>
              <Button onClick={() => void navigate('/admin')}>{t('setup.later')}</Button>
            </Box>
          </>
        ) : (
          <Box>
            <Button variant="contained" disableElevation onClick={() => void navigate('/admin')}>
              {t('setup.toAdmin')}
            </Button>
          </Box>
        )}
      </Box>
    );
  }

  const providerReady =
    name.length > 0 && provider.authority.trim().length > 0 && provider.clientId.trim().length > 0;

  return (
    <Box
      component="section"
      aria-label={t('setup.title')}
      sx={{ maxWidth: 560, display: 'grid', gap: 2, pb: 10 }}
    >
      <Box>
        <Typography variant="h6">{t('setup.title')}</Typography>
        <Typography variant="caption" color="text.secondary">
          {t('setup.stepOf', {
            step: step + 1,
            steps: STEPS.length,
            name: t(`setup.step.${current}`),
          })}
        </Typography>
      </Box>

      {current === 'address' && (
        <>
          <Typography color="text.secondary">{t('setup.addressText')}</Typography>
          <TextField
            label={t('serverSettings.PUBLIC_URL')}
            value={addressSetting?.locked ? (addressSetting.value ?? '') : address}
            onChange={(event) => setAddress(event.target.value)}
            disabled={addressSetting?.locked}
            helperText={addressSetting?.locked ? t('setup.locked') : t('setup.addressHint')}
            slotProps={{ htmlInput: { spellCheck: false } }}
          />
        </>
      )}

      {current === 'provider' && (
        <>
          <Typography color="text.secondary">{t('setup.providerText')}</Typography>
          {providers?.value && (
            <Typography variant="body2">
              {t('setup.providersNow', { names: providers.value })}
            </Typography>
          )}
          {providers?.locked ? (
            <Alert severity="info" variant="outlined">
              {t('setup.providersLocked')}
            </Alert>
          ) : (
            <>
              <TextField
                label={t('setup.providerLabel')}
                placeholder="Pocket ID"
                value={provider.label}
                onChange={(event) => setProvider({ ...provider, label: event.target.value })}
              />
              <TextField
                label={t('serverSettings.provider.AUTHORITY')}
                placeholder="https://id.example.com"
                value={provider.authority}
                onChange={(event) => setProvider({ ...provider, authority: event.target.value })}
                slotProps={{ htmlInput: { spellCheck: false } }}
              />
              <TextField
                label={t('serverSettings.provider.CLIENT_ID')}
                value={provider.clientId}
                onChange={(event) => setProvider({ ...provider, clientId: event.target.value })}
                slotProps={{ htmlInput: { spellCheck: false } }}
              />
              <PasswordField
                label={t('serverSettings.provider.CLIENT_SECRET')}
                value={provider.clientSecret}
                onChange={(event) => setProvider({ ...provider, clientSecret: event.target.value })}
                helperText={t('setup.secretHint')}
                slotProps={{ htmlInput: { autoComplete: 'off' } }}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={provider.autoCreate}
                    onChange={(event) =>
                      setProvider({ ...provider, autoCreate: event.target.checked })
                    }
                  />
                }
                label={t('serverSettings.provider.AUTO_CREATE')}
              />
              {name && (
                <Alert severity="info" variant="outlined">
                  {t('setup.callback', { url: `${base}/auth/oidc/${name}/callback` })}
                </Alert>
              )}
            </>
          )}
        </>
      )}

      {current === 'join' && (
        <>
          <Typography color="text.secondary">{t('setup.joinText')}</Typography>
          <RadioGroup
            value={joinSetting?.locked ? (joinSetting.value ?? 'invite') : join}
            onChange={(event) => setJoin(event.target.value)}
            aria-label={t('serverSettings.REGISTRATION')}
          >
            {(['invite', 'open', 'closed'] as const).map((each) => (
              <FormControlLabel
                key={each}
                value={each}
                disabled={joinSetting?.locked}
                control={<Radio />}
                label={
                  <Box>
                    <Typography>{t(`setup.join.${each}`)}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t(`setup.join.${each}.hint`)}
                    </Typography>
                  </Box>
                }
                sx={{ alignItems: 'flex-start', mb: 1, '& .MuiRadio-root': { pt: 0.5 } }}
              />
            ))}
          </RadioGroup>
          {joinSetting?.locked && <Typography variant="caption">{t('setup.locked')}</Typography>}
        </>
      )}

      {problem && (
        <Alert severity="error" variant="outlined">
          {problem}
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        {step > 0 && <Button onClick={() => go(step - 1)}>{t('setup.back')}</Button>}
        <Box sx={{ flexGrow: 1 }} />
        <Button onClick={notNow}>{t('setup.notNow')}</Button>
        {current === 'provider' && !providers?.locked && (
          <Button onClick={() => go(step + 1)}>{t('setup.skip')}</Button>
        )}
        <Button
          variant="contained"
          disableElevation
          disabled={busy || (current === 'provider' && !providers?.locked && !providerReady)}
          onClick={() => void next()}
        >
          {step === STEPS.length - 1 ? t('setup.finish') : t('setup.next')}
        </Button>
      </Box>
    </Box>
  );
}
