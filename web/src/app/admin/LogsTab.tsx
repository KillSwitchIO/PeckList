import { Box, Button, Link, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useState } from 'react';
import type { AdminApi, LogOutput } from '../../ports/admin.ts';
import type { MessageKey } from '../i18n/en.ts';
import { t } from '../i18n/i18n.ts';
import { AuditView } from './AuditView.tsx';
import { SETTINGS_ON } from './settingsGroups.ts';
import { SettingsTab } from './SettingsTab.tsx';
import { useLoaded } from './useAdmin.ts';

const OUTPUTS: Record<string, MessageKey> = {
  console: 'admin.logs.output.console',
  file: 'admin.logs.output.file',
  otlp: 'admin.logs.output.otlp',
  loki: 'admin.logs.output.loki',
  gelf: 'admin.logs.output.gelf',
  elastic: 'admin.logs.output.elastic',
  syslog: 'admin.logs.output.syslog',
};

function OutputRow({ output }: { output: LogOutput }) {
  const label = OUTPUTS[output.name] ? t(OUTPUTS[output.name]!) : output.name;
  return (
    <Box
      role="listitem"
      aria-label={label}
      sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, py: 0.75 }}
    >
      <Box
        aria-hidden
        sx={{
          width: 8,
          height: 8,
          mt: 1,
          borderRadius: '50%',
          flexShrink: 0,
          bgcolor: output.healthy ? 'success.main' : 'error.main',
        }}
      />
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography>{label}</Typography>
        <Typography variant="caption" color="text.secondary" component="div" noWrap>
          {output.destination}
        </Typography>
        <Typography variant="caption" color="text.secondary" component="div">
          {output.healthy ? t('admin.logs.sending') : t('admin.logs.failing')}
          {' · '}
          {t('admin.logs.counts', { sent: output.sent, dropped: output.dropped })}
        </Typography>
        {!output.healthy && output.lastError && (
          <Typography
            variant="caption"
            color="error"
            component="div"
            sx={{ wordBreak: 'break-word' }}
          >
            {output.lastError}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

/** Where the server's logs go and whether each output keeps up, and the debug dump. */
function OutputsView({ api, onChange }: { api: AdminApi; onChange: () => void }) {
  const { data, reload } = useLoaded(api.logging);
  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Box component="section" aria-label={t('admin.logs.outputs')}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
          <Typography variant="subtitle2" color="text.secondary" sx={{ flexGrow: 1 }}>
            {t('admin.logs.outputs')}
          </Typography>
          <Button size="small" onClick={reload}>
            {t('admin.logs.refresh')}
          </Button>
        </Box>
        {data && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t('admin.logs.level', { level: data.level })}{' '}
            <Link component="button" variant="body2" onClick={onChange}>
              {t('admin.logs.change')}
            </Link>
          </Typography>
        )}
        <Box role="list">
          {(data?.outputs ?? []).map((output) => (
            <OutputRow key={output.name} output={output} />
          ))}
        </Box>
      </Box>

      <Box component="section" aria-label={t('admin.logs.dumpTitle')}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
          {t('admin.logs.dumpTitle')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t('admin.logs.dumpHint')}
        </Typography>
        <Button variant="outlined" href={api.debugDumpUrl()} download>
          {t('admin.logs.dump')}
        </Button>
      </Box>
    </Box>
  );
}

type LogsView = 'event' | 'access' | 'outputs' | 'settings';

/**
 * Admin > Logs (spec: Logging, Access and event log): what people did, every request, and where
 * the server's logs go, and the settings for all of that.
 */
export function LogsTab({ api }: { api: AdminApi }) {
  const [view, setView] = useState<LogsView>('event');
  return (
    <Box sx={{ maxWidth: 720, display: 'grid', gap: 2 }}>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={view}
        onChange={(_, next: LogsView | null) => next && setView(next)}
        aria-label={t('admin.logs.view')}
        sx={{ justifySelf: 'start' }}
      >
        <ToggleButton value="event" sx={{ textTransform: 'none', px: 2 }}>
          {t('audit.events')}
        </ToggleButton>
        <ToggleButton value="access" sx={{ textTransform: 'none', px: 2 }}>
          {t('audit.requests')}
        </ToggleButton>
        <ToggleButton value="outputs" sx={{ textTransform: 'none', px: 2 }}>
          {t('admin.logs.outputsTab')}
        </ToggleButton>
        <ToggleButton value="settings" sx={{ textTransform: 'none', px: 2 }}>
          {t('admin.logs.settingsTab')}
        </ToggleButton>
      </ToggleButtonGroup>
      {view === 'settings' ? (
        <SettingsTab api={api} only={SETTINGS_ON.logs} />
      ) : view === 'outputs' ? (
        <OutputsView api={api} onChange={() => setView('settings')} />
      ) : (
        <AuditView key={view} api={api} kind={view} />
      )}
    </Box>
  );
}
