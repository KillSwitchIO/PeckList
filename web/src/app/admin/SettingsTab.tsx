import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Collapse,
  MenuItem,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useState, type ReactNode } from 'react';
import type {
  AdminApi,
  MailPreset,
  ServerSetting,
  ServerSettingsView,
  TelemetryView,
} from '../../ports/admin.ts';
import type { MessageKey } from '../i18n/en.ts';
import { t } from '../i18n/i18n.ts';
import { ChevronRightIcon } from '../icons/icons.tsx';
import { ProblemAlert } from '../layout/ProblemAlert.tsx';
import { PasswordField } from '../layout/PasswordField.tsx';
import { MailTestPanel } from './MailTestPanel.tsx';
import { TelemetryNotice, TelemetryPanel } from './TelemetryPanel.tsx';
import { useIsSuperAdmin, useLoaded } from './useAdmin.ts';

const LABELS: Record<string, MessageKey> = {
  PUBLIC_URL: 'serverSettings.PUBLIC_URL',
  REGISTRATION: 'serverSettings.REGISTRATION',
  ACCOUNT_DELETE_GRACE_DAYS: 'serverSettings.ACCOUNT_DELETE_GRACE_DAYS',
  ATTACHMENT_DIR: 'serverSettings.ATTACHMENT_DIR',
  UMAMI_URL: 'serverSettings.UMAMI_URL',
  UMAMI_WEBSITE_ID: 'serverSettings.UMAMI_WEBSITE_ID',
  UMAMI_RECORDER: 'serverSettings.UMAMI_RECORDER',
  LOCAL_LOGIN: 'serverSettings.LOCAL_LOGIN',
  PASSKEYS: 'serverSettings.PASSKEYS',
  OIDC_PROVIDERS: 'serverSettings.OIDC_PROVIDERS',
  BACKUP_SCHEDULE: 'serverSettings.SNAPSHOT_SCHEDULE',
  SNAPSHOT_KEEP: 'serverSettings.SNAPSHOT_KEEP',
  ATTACHMENT_MAX_MB: 'serverSettings.ATTACHMENT_MAX_MB',
  ATTACHMENT_DAILY_MB: 'serverSettings.ATTACHMENT_DAILY_MB',
  SNAPSHOT_KEEP_WEEKLY: 'serverSettings.SNAPSHOT_KEEP_WEEKLY',
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
  CRASH_REPORTS: 'serverSettings.CRASH_REPORTS',
  TELEMETRY_URL: 'serverSettings.TELEMETRY_URL',
  DO_NOT_TRACK: 'serverSettings.DO_NOT_TRACK',
  SIGNUP_RATE_LIMIT: 'serverSettings.SIGNUP_RATE_LIMIT',
  SMTP_PROVIDER: 'serverSettings.SMTP_PROVIDER',
  SMTP_HOST: 'serverSettings.SMTP_HOST',
  SMTP_PORT: 'serverSettings.SMTP_PORT',
  SMTP_TLS: 'serverSettings.SMTP_TLS',
  SMTP_USER: 'serverSettings.SMTP_USER',
  SMTP_PASSWORD: 'serverSettings.SMTP_PASSWORD',
  SMTP_FROM: 'serverSettings.SMTP_FROM',
  DEMO_MODE: 'serverSettings.DEMO_MODE',
  DEMO_ACCOUNTS: 'serverSettings.DEMO_ACCOUNTS',
  DEMO_RESET_TIME: 'serverSettings.DEMO_RESET_TIME',
  DEMO_RESET_EVERY: 'serverSettings.DEMO_RESET_EVERY',
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
  email: 'serverSettings.group.email',
  telemetry: 'serverSettings.group.telemetry',
  environment: 'serverSettings.group.environment',
};

/** Choices with a name of their own; any other shows as the server spells it. */
const CHOICE_LABELS = new Set<string>([
  'REGISTRATION',
  'LOCAL_LOGIN',
  'PASSKEYS',
  'BACKUP_SCHEDULE',
  'LOG_LEVEL',
  'LOG_FORMAT',
  'SMTP_TLS',
  'AUTH_MODE',
  'DB_PROVIDER',
]);

/** Log servers that take more than one setting fold up under their name. */
const LOG_SERVERS: [prefix: string, name: MessageKey][] = [
  ['LOG_OTLP_', 'admin.logs.output.otlp'],
  ['LOG_LOKI_', 'admin.logs.output.loki'],
  ['LOG_GELF_', 'admin.logs.output.gelf'],
  ['LOG_ELASTIC_', 'admin.logs.output.elastic'],
  ['LOG_SYSLOG_', 'admin.logs.output.syslog'],
];

const SECRET_SHOWN = '********';

function choiceText(key: string, choice: string): string {
  return CHOICE_LABELS.has(key) ? t(`serverSettings.${key}.${choice}` as MessageKey) : choice;
}

/** A default as the admin knows it: the choice's name, or on and off for a switch. */
function defaultText(setting: ServerSetting): string {
  const value = setting.default ?? '';
  if (setting.kind === 'flag')
    return t(value === 'true' ? 'serverSettings.flagOn' : 'serverSettings.flagOff');
  return setting.kind === 'choice' ? choiceText(setting.key, value) : value;
}

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

/**
 * Where the value comes from, under the setting's name. The variable's own name shows where it is
 * the point: where the environment or the file decides, and for what only they can set. Everywhere
 * else it is in the name's tooltip.
 */
function sourceText(setting: ServerSetting): string {
  if (setting.source === 'environment')
    return t('serverSettings.from.environment', { key: setting.key });
  if (setting.source === 'file') return t('serverSettings.from.file', { key: setting.key });
  if (setting.source === 'page') return t('serverSettings.from.page');
  const named = setting.group === 'environment';
  if (setting.default)
    return named
      ? t('serverSettings.from.defaultNamed', { key: setting.key, value: defaultText(setting) })
      : t('serverSettings.from.default', { value: defaultText(setting) });
  return named ? setting.key : '';
}

const GROUP_ORDER = ['general', 'network', 'telemetry', 'logging', 'audit', 'log-shipping'];
/** The fixed groups in order; what is left (a provider's) next, and the read-only ones last. */
const rankOf = (group: string) =>
  group === 'environment' ? 100 : GROUP_ORDER.includes(group) ? GROUP_ORDER.indexOf(group) : 50;

/** Long or rarely needed settings, folded up under one row. */
function Folded({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Box component="section" aria-label={title}>
      <ButtonBase
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        sx={{
          display: 'flex',
          width: 'calc(100% + 16px)',
          mx: -1,
          px: 1,
          py: 1,
          gap: 1,
          justifyContent: 'flex-start',
          textAlign: 'left',
          borderRadius: 2,
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <ChevronRightIcon
          fontSize="small"
          sx={{
            color: 'text.secondary',
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform 120ms',
          }}
        />
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography>{title}</Typography>
          {note && (
            <Typography variant="caption" color="text.secondary" component="div">
              {note}
            </Typography>
          )}
        </Box>
      </ButtonBase>
      <Collapse in={open} unmountOnExit>
        {children}
      </Collapse>
    </Box>
  );
}

/** The mail provider picked (typed or saved), when it is a preset rather than "custom". */
function mailPreset(view: ServerSettingsView, edits: Record<string, string>): MailPreset | null {
  const setting = view.settings.find((each) => each.key === 'SMTP_PROVIDER');
  const name = (edits.SMTP_PROVIDER ?? setting?.value ?? setting?.default ?? '').toLowerCase();
  return view.mailProviders?.find((each) => each.name === name) ?? null;
}

function SettingControl({
  setting,
  value,
  onChange,
  choiceLabel = (choice: string) => choiceText(setting.key, choice),
}: {
  setting: ServerSetting;
  value: string;
  onChange: (value: string) => void;
  choiceLabel?: ((choice: string) => string) | undefined;
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
            {choiceLabel(choice)}
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
      sx={{ width: setting.kind === 'number' ? 120 : { xs: '100%', sm: 280 } }}
    />
  );
}

const NO_TELEMETRY = (): Promise<TelemetryView | null> => Promise.resolve(null);

/**
 * The server's settings (spec: Server settings) a page of Admin asks for: each one, where it comes
 * from, and the ones the environment or config file decide shown greyed out. Logging applies when
 * saved; the rest after a restart. `titled` names a group even when it is the page's only one.
 */
export function SettingsTab({
  api,
  only,
  titled = false,
}: {
  api: AdminApi;
  only: (group: string) => boolean;
  titled?: boolean;
}) {
  const superAdmin = useIsSuperAdmin();
  const { data, reload } = useLoaded(api.settings);
  const showsTelemetry = only('telemetry');
  const telemetry = useLoaded(showsTelemetry ? api.telemetry : NO_TELEMETRY);
  const [saved, setSaved] = useState<ServerSettingsView | null>(null);
  const view = saved ?? data;
  // What the admin has typed, by key; a secret's field starts empty (never shown).
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);

  if (!view) return null;
  // Picking a mail provider fills in its server: those fields show its values, greyed out (an
  // environment or config file value still wins, and shows as it does anywhere else).
  const preset = mailPreset(view, edits);
  const presetValue = (setting: ServerSetting) =>
    setting.locked ? undefined : preset?.sets[setting.key];
  const providerName = (choice: string) =>
    choice === 'custom'
      ? t('serverSettings.SMTP_PROVIDER.custom')
      : (view.mailProviders?.find((each) => each.name === choice)?.displayName ?? choice);
  const change = (setting: ServerSetting, value: string) => {
    if (setting.key !== 'SMTP_PROVIDER') {
      setEdits({ ...edits, [setting.key]: value });
      return;
    }
    const picked = view.mailProviders?.find((each) => each.name === value);
    // The provider decides its fields now: what was typed there goes.
    const next: Record<string, string> = Object.fromEntries(
      Object.entries(edits).filter(([key]) => !picked || !(key in picked.sets)),
    );
    next.SMTP_PROVIDER = value;
    for (const each of view.settings) {
      if (each.locked) continue;
      if (picked && each.key in picked.sets) {
        // A value saved here would win over the provider's, so it goes too.
        if (each.source === 'page') next[each.key] = '';
      } else if (!picked && preset && each.key in preset.sets && !(each.key in edits)) {
        // To "Other": start from what the provider used.
        if (each.source !== 'page') next[each.key] = preset.sets[each.key]!;
      }
    }
    setEdits(next);
  };
  // A locked field shows the value in force (greyed out); an editable one what is saved here.
  const shown = (setting: ServerSetting) => {
    const typed = edits[setting.key];
    if (typed !== undefined) return typed;
    if (setting.kind === 'secret') return '';
    return setting.locked || setting.source === 'page' ? (setting.value ?? '') : '';
  };
  const groups = [...new Set(view.settings.map((setting) => setting.group))]
    .filter(only)
    .sort((a, b) => rankOf(a) - rankOf(b));

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
  // Email settings typed but not saved: the test email saves them first (they apply at once).
  const emailKeys = view.settings.filter((each) => each.group === 'email').map((each) => each.key);
  const unsavedEmail = Object.keys(edits).filter((key) => emailKeys.includes(key));
  const saveEmail = async (): Promise<string | null> => {
    const result = await api.saveSettings(
      Object.fromEntries(unsavedEmail.map((key) => [key, edits[key]!])),
    );
    if (!result.ok) return result.message;
    setSaved(result.value);
    setEdits(
      Object.fromEntries(Object.entries(edits).filter(([key]) => !unsavedEmail.includes(key))),
    );
    return null;
  };
  const dirty = Object.keys(edits).length > 0;

  const row = (setting: ServerSetting) => {
    const fixed = presetValue(setting);
    const suggested = preset?.suggests[setting.key];
    const control =
      fixed !== undefined
        ? { ...setting, locked: true }
        : suggested !== undefined
          ? { ...setting, default: suggested }
          : setting;
    const source =
      fixed !== undefined && preset
        ? t('serverSettings.from.provider', { key: setting.key, provider: preset.displayName })
        : sourceText(control);
    const notes = [
      ...(source ? [source] : []),
      ...(setting.locked && setting.saved ? [t('serverSettings.overrides')] : []),
      ...(setting.superAdminOnly && !superAdmin ? [t('serverSettings.superAdminOnly')] : []),
    ];
    return (
      <Box
        key={setting.key}
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          columnGap: 2,
          rowGap: 1,
          py: 1,
          opacity: control.locked ? 0.7 : 1,
        }}
      >
        <Box sx={{ flex: '1 1 10rem', minWidth: 0 }}>
          <Tooltip title={setting.key} placement="top-start" enterTouchDelay={0}>
            <Typography sx={{ display: 'inline-block' }}>{labelOf(setting)}</Typography>
          </Tooltip>
          {notes.length > 0 && (
            <Typography variant="caption" color="text.secondary" component="div">
              {notes.join(' · ')}
            </Typography>
          )}
        </Box>
        <SettingControl
          setting={control}
          value={fixed ?? shown(setting)}
          onChange={(value) => change(setting, value)}
          choiceLabel={setting.key === 'SMTP_PROVIDER' ? providerName : undefined}
        />
      </Box>
    );
  };

  const groupView = (group: string) => {
    const settings = view.settings.filter((setting) => setting.group === group);
    const title = groupTitle(group);
    if (group === 'environment' || group.startsWith('provider:')) {
      return (
        <Folded
          key={group}
          title={title}
          {...(group === 'environment' ? { note: t('serverSettings.environmentHint') } : {})}
        >
          {settings.map(row)}
        </Folded>
      );
    }
    // The only group on its page, or the page's own: the list beside it already names it.
    const named = titled || (groups.length > 1 && group !== 'general' && group !== 'sign-in');
    return (
      <Box component="section" key={group} aria-label={title}>
        {named && (
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
            {title}
          </Typography>
        )}
        {group === 'log-shipping'
          ? LOG_SERVERS.map(([prefix, name]) => {
              const own = settings.filter((setting) => setting.key.startsWith(prefix));
              const inUse = own.some((setting) => setting.source !== 'default');
              return (
                <Folded
                  key={prefix}
                  title={t(name)}
                  note={t(inUse ? 'serverSettings.logServerOn' : 'serverSettings.logServerOff')}
                >
                  {own.map(row)}
                </Folded>
              );
            })
          : settings.map(row)}
        {group === 'email' && (
          <MailTestPanel api={api} saveFirst={unsavedEmail.length > 0 ? saveEmail : undefined} />
        )}
        {group === 'telemetry' && (
          <TelemetryPanel view={telemetry.data} api={api} onChange={telemetry.reload} />
        )}
      </Box>
    );
  };

  return (
    <Box sx={{ maxWidth: 720, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 3 }}>
      {view.problem && (
        <Alert severity="error" variant="outlined">
          {t('serverSettings.setAside', { problem: view.problem })}
        </Alert>
      )}
      {showsTelemetry && (
        <TelemetryNotice view={telemetry.data} api={api} onSeen={telemetry.reload} />
      )}
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
      {groups.map(groupView)}
      <ProblemAlert problem={problem} />
      {/* Kept in sight while something is unsaved: the page is long, and a change made at the top
          is easy to leave unsaved. */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          ...(dirty && {
            position: 'sticky',
            bottom: 0,
            zIndex: 1,
            py: 1.5,
            bgcolor: 'background.default',
            borderTop: 1,
            borderColor: 'divider',
          }),
        }}
      >
        <Button variant="contained" disableElevation disabled={!dirty} onClick={() => void save()}>
          {t('admin.save')}
        </Button>
        <Button
          disabled={!dirty}
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
