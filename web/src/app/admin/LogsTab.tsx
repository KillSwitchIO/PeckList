import { Box, Button, Link, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router';
import type { AdminApi, LogOutput } from '../../ports/admin.ts';
import type { MessageKey } from '../i18n/en.ts';
import { t } from '../i18n/i18n.ts';
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
      sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, px: 1, py: 0.75 }}
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

/**
 * Admin > Logs (spec: Logging): where the server's logs go and whether each output keeps up, and
 * the debug dump for bug reports. Levels and outputs are set on the Settings tab.
 */
export function LogsTab({ api }: { api: AdminApi }) {
  const { data, reload } = useLoaded(api.logging);
  return (
    <Box sx={{ maxWidth: 720, display: 'grid', gap: 3, pb: 10 }}>
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
            <Link component={RouterLink} to="/admin/settings">
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
