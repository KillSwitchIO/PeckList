import { Alert, Box, Button, MenuItem, Switch, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import type { AdminApi, ServerSetting, ServerSettingsView } from '../../ports/admin.ts';
import type { MessageKey } from '../i18n/en.ts';
import { t } from '../i18n/i18n.ts';
import { ProblemAlert } from '../layout/ProblemAlert.tsx';
import { PasswordField } from '../layout/PasswordField.tsx';
import { TelemetryNotice, TelemetryPanel } from './TelemetryPanel.tsx';
import { useIsSuperAdmin, useLoaded } from './useAdmin.ts';

const LABELS: Record<string, MessageKey> = {
  PUBLIC_URL: 'serverSettings.PUBLIC_URL',
  REGISTRATION: 'serverSettings.REGISTRATION',
  LOCAL_LOGIN: 'serverSettings.LOCAL_LOGIN',
  OIDC_PROVIDERS: 'serverSettings.OIDC_PROVIDERS',
  BACKUP_SCHEDULE: 'serverSettings.SNAPSHOT_SCHEDULE',
  SNAPSHOT_KEEP: 'serverSettings.SNAPSHOT_KEEP',
  TRUSTED_PROXIES: 'serverSettings.TRUSTED_PROXIES',
  LOG_LEVEL: 'serverSettings.LOG_LEVEL',
  LOG_LEVEL_OVERRIDES: 'serverSettings.LOG_LEVEL_OVERRIDES',
  LOG_FORMAT: 'serverSettings.LOG_FORMAT',
  LOG_FILES: 'serverSettings.LOG_FILES',
  LOG_FILE_MAX_MB: 'serverSettings.LOG_FILE_MAX_MB',
  LOG_FILE_KEEP_DAYS: 'serverSettings.LOG_FILE_KEEP_DAYS',
  LOG_OTLP_ENDPOINT: 'serverSettings.LOG_OTLP_ENDPOINT',
  LOG_OTLP_HEADERS: 'serverSettings.LOG_OTLP_HEADERS',
  LOG_LOKI_URL: 'serverSettings.LOG_LOKI_URL',
  LOG_LOKI_USERNAME: 'serverSettings.LOG_LOKI_USERNAME',
  LOG_LOKI_PASSWORD: 'serverSettings.LOG_LOKI_PASSWORD',
  LOG_LOKI_TENANT: 'serverSettings.LOG_LOKI_TENANT',
  LOG_GELF_ADDRESS: 'serverSettings.LOG_GELF_ADDRESS',
  LOG_ELASTIC_URL: 'serverSettings.LOG_ELASTIC_URL',
  LOG_ELASTIC_INDEX: 'serverSettings.LOG_ELASTIC_INDEX',
  LOG_ELASTIC_USERNAME: 'serverSettings.LOG_ELASTIC_USERNAME',
  LOG_ELASTIC_PASSWORD: 'serverSettings.LOG_ELASTIC_PASSWORD',
  LOG_ELASTIC_API_KEY: 'serverSettings.LOG_ELASTIC_API_KEY',
  LOG_SYSLOG_ADDRESS: 'serverSettings.LOG_SYSLOG_ADDRESS',
  LOG_DIR: 'serverSettings.LOG_DIR',
  AUDIT_RETENTION_DAYS: 'serverSettings.AUDIT_RETENTION_DAYS',
  ACCESS_LOG_RETENTION_DAYS: 'serverSettings.ACCESS_LOG_RETENTION_DAYS',
  AUDIT_ARCHIVE: 'serverSettings.AUDIT_ARCHIVE',
  UPDATE_CHECK: 'serverSettings.UPDATE_CHECK',
  API_DOCS: 'serverSettings.API_DOCS',
  TELEMETRY: 'serverSettings.TELEMETRY',
  TELEMETRY_URL: 'serverSettings.TELEMETRY_URL',
  DO_NOT_TRACK: 'serverSettings.DO_NOT_TRACK',
  SIGNUP_RATE_LIMIT: 'serverSettings.SIGNUP_RATE_LIMIT',
  DEMO_MODE: 'serverSettings.DEMO_MODE',
  DEMO_ACCOUNTS: 'serverSettings.DEMO_ACCOUNTS',
  DEMO_RESET_TIME: 'serverSettings.DEMO_RESET_TIME',
  AUDIT_ARCHIVE_DIR: 'serverSettings.AUDIT_ARCHIVE_DIR',
  AUTH_MODE: 'serverSettings.AUTH_MODE',
  ADMIN_PASSWORD: 'serverSettings.ADMIN_PASSWORD',
  DB_PROVIDER: 'serverSettings.DB_PROVIDER',
  DB_PATH: 'serverSettings.DB_PATH',
  DB_CONNECTION_STRING: 'serverSettings.DB_CONNECTION_STRING',
  DB_MIGRATE_ON_START: 'serverSettings.DB_MIGRATE_ON_START',
  SNAPSHOT_DIR: 'serverSettings.SNAPSHOT_DIR',
  WEB_ROOT: 'serverSettings.WEB_ROOT',
  CONFIG_FILE: 'serverSettings.CONFIG_FILE',
  CONFIG_KEY: 'serverSettings.CONFIG_KEY',
};

/** Labels for each provider's settings, by the part after OIDC_<NAME>_. */
const PROVIDER_LABELS: Record<string, MessageKey> = {
  AUTHORITY: 'serverSettings.provider.AUTHORITY',
  CLIENT_ID: 'serverSettings.provider.CLIENT_ID',
  CLIENT_SECRET: 'serverSettings.provider.CLIENT_SECRET',
  DISPLAY_NAME: 'serverSettings.provider.DISPLAY_NAME',
  SCOPES: 'serverSettings.provider.SCOPES',
  GROUPS_CLAIM: 'serverSettings.provider.GROUPS_CLAIM',
  USERNAME_CLAIM: 'serverSettings.provider.USERNAME_CLAIM',
  REQUIRED_GROUPS: 'serverSettings.provider.REQUIRED_GROUPS',
  AUTO_CREATE: 'serverSettings.provider.AUTO_CREATE',
  LINK_BY_EMAIL: 'serverSettings.provider.LINK_BY_EMAIL',
  ROLE_MAP: 'serverSettings.provider.ROLE_MAP',
  GROUP_MAP: 'serverSettings.provider.GROUP_MAP',
  SESSION_HOURS: 'serverSettings.provider.SESSION_HOURS',
  SIGN_OUT: 'serverSettings.provider.SIGN_OUT',
};

const GROUPS: Record<string, MessageKey> = {
  general: 'serverSettings.group.general',
  'sign-in': 'serverSettings.group.sign-in',
  backups: 'serverSettings.group.backups',
  network: 'serverSettings.group.network',
  logging: 'serverSettings.group.logging',
  'log-shipping': 'serverSettings.group.log-shipping',
  audit: 'serverSettings.group.audit',
  telemetry: 'serverSettings.group.telemetry',
  environment: 'serverSettings.group.environment',
};

const SECRET_SHOWN = '********';

function labelOf(setting: ServerSetting): string {
  const fixed = LABELS[setting.key];
  if (fixed) return t(fixed);
  const suffix = Object.keys(PROVIDER_LABELS).find((each) => setting.key.endsWith(`_${each}`));
  return suffix ? t(PROVIDER_LABELS[suffix]!) : setting.key;
}

function groupTitle(group: string): string {
  if (group.startsWith('provider:'))
    return t('serverSettings.group.provider', { name: group.slice(9) });
  const key = GROUPS[group];
  return key ? t(key) : group;
}

/** Where the value comes from, under the setting's name. */
function sourceText(setting: ServerSetting): string {
  if (setting.source === 'environment')
    return t('serverSettings.from.environment', { key: setting.key });
  if (setting.source === 'file') return t('serverSettings.from.file', { key: setting.key });
  if (setting.source === 'page') return t('serverSettings.from.page', { key: setting.key });
  return setting.default
    ? t('serverSettings.from.default', { key: setting.key, value: setting.default })
    : setting.key;
}

function SettingControl({
  setting,
  value,
  onChange,
}: {
  setting: ServerSetting;
  value: string;
  onChange: (value: string) => void;
}) {
  const label = labelOf(setting);
  if (setting.kind === 'flag') {
    return (
      <Switch
        checked={(value || setting.default) === 'true'}
        disabled={setting.locked}
        onChange={(event) => onChange(event.target.checked ? 'true' : 'false')}
        slotProps={{ input: { 'aria-label': label } }}
      />
    );
  }
  if (setting.kind === 'choice') {
    return (
      <TextField
        select
        size="small"
        value={value || setting.default || ''}
        disabled={setting.locked}
        onChange={(event) => onChange(event.target.value)}
        slotProps={{ htmlInput: { 'aria-label': label } }}
        sx={{ minWidth: 160 }}
      >
        {(setting.choices ?? []).map((choice) => (
          <MenuItem key={choice} value={choice}>
            {choice}
          </MenuItem>
        ))}
      </TextField>
    );
  }
  if (setting.kind === 'secret') {
    return (
      <PasswordField
        size="small"
        value={value}
        placeholder={setting.value ? SECRET_SHOWN : (setting.default ?? '')}
        disabled={setting.locked}
        onChange={(event) => onChange(event.target.value)}
        slotProps={{ htmlInput: { 'aria-label': label, autoComplete: 'off', spellCheck: false } }}
        sx={{ width: { xs: '100%', sm: 280 } }}
      />
    );
  }
  return (
    <TextField
      size="small"
      type={setting.kind === 'number' ? 'number' : 'text'}
      value={value}
      placeholder={setting.default ?? ''}
      disabled={setting.locked}
      onChange={(event) => onChange(event.target.value)}
      slotProps={{ htmlInput: { 'aria-label': label, autoComplete: 'off', spellCheck: false } }}
      sx={{ width: { xs: '100%', sm: 280 } }}
    />
  );
}

/**
 * Admin > Settings (spec: Server settings): every setting, where it comes from, and the ones the
 * environment or config file decide shown greyed out. Logging applies when saved; the rest after
 * a restart.
 */
export function SettingsTab({ api }: { api: AdminApi }) {
  const superAdmin = useIsSuperAdmin();
  const { data, reload } = useLoaded(api.settings);
  const telemetry = useLoaded(api.telemetry);
  const [saved, setSaved] = useState<ServerSettingsView | null>(null);
  const view = saved ?? data;
  // What the admin has typed, by key; a secret's field starts empty (never shown).
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);

  if (!view) return null;
  // A locked field shows the value in force (greyed out); an editable one what is saved here.
  const shown = (setting: ServerSetting) => {
    const typed = edits[setting.key];
    if (typed !== undefined) return typed;
    if (setting.kind === 'secret') return '';
    return setting.locked || setting.source === 'page' ? (setting.value ?? '') : '';
  };
  const groups = [...new Set(view.settings.map((setting) => setting.group))].sort(
    (a, b) => Number(a === 'environment') - Number(b === 'environment'),
  );

  const save = async () => {
    setProblem(null);
    const result = await api.saveSettings(edits);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setSaved(result.value);
    setEdits({});
  };

  return (
    <Box
      sx={{ maxWidth: 720, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 3, pb: 10 }}
    >
      {view.problem && (
        <Alert severity="error" variant="outlined">
          {t('serverSettings.setAside', { problem: view.problem })}
        </Alert>
      )}
      <TelemetryNotice view={telemetry.data} api={api} onSeen={telemetry.reload} />
      {view.pendingRestart && (
        <Alert
          severity="info"
          variant="outlined"
          action={
            <Button
              color="inherit"
              size="small"
              disabled={restarting}
              onClick={() => {
                setRestarting(true);
                void api.restart();
              }}
            >
              {t('serverSettings.restart')}
            </Button>
          }
        >
          {restarting ? t('serverSettings.restarting') : t('serverSettings.pending')}
        </Alert>
      )}
      {groups.map((group) => (
        <Box component="section" key={group} aria-label={groupTitle(group)}>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
            {groupTitle(group)}
          </Typography>
          {view.settings
            .filter((setting) => setting.group === group)
            .map((setting) => (
              <Box
                key={setting.key}
                sx={{
                  display: 'flex',
                  flexWrap: { xs: 'wrap', sm: 'nowrap' },
                  alignItems: 'center',
                  gap: { xs: 1, sm: 2 },
                  px: 1,
                  py: 1,
                  opacity: setting.locked ? 0.7 : 1,
                }}
              >
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography>{labelOf(setting)}</Typography>
                  <Typography variant="caption" color="text.secondary" component="div">
                    {sourceText(setting)}
                    {setting.locked && setting.saved && ` · ${t('serverSettings.overrides')}`}
                    {setting.superAdminOnly &&
                      !superAdmin &&
                      ` · ${t('serverSettings.superAdminOnly')}`}
                  </Typography>
                </Box>
                <SettingControl
                  setting={setting}
                  value={shown(setting)}
                  onChange={(value) => setEdits({ ...edits, [setting.key]: value })}
                />
              </Box>
            ))}
          {group === 'telemetry' && (
            <TelemetryPanel view={telemetry.data} api={api} onChange={telemetry.reload} />
          )}
        </Box>
      ))}
      <ProblemAlert problem={problem} />
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button
          variant="contained"
          disableElevation
          disabled={Object.keys(edits).length === 0}
          onClick={() => void save()}
        >
          {t('admin.save')}
        </Button>
        <Button
          disabled={Object.keys(edits).length === 0}
          onClick={() => {
            setEdits({});
            setProblem(null);
            reload();
          }}
        >
          {t('admin.cancel')}
        </Button>
      </Box>
    </Box>
  );
}
