import { Box, Button, MenuItem, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { localDateTimeOf, localTimeZone } from '../../core/dates.ts';
import type { AdminApi, AuditEntry, AuditKind, AuditQuery } from '../../ports/admin.ts';
import { formatWhen } from '../format.ts';
import { useToday } from '../hooks/useToday.ts';
import type { MessageKey } from '../i18n/en.ts';
import { t } from '../i18n/i18n.ts';
import { describe, deviceName } from './auditText.ts';

const PAGE = 50;

/** Event types by area, for the type filter (a prefix ending in a dot). */
const AREAS: { prefix: string; label: MessageKey }[] = [
  { prefix: 'auth.', label: 'audit.area.auth' },
  { prefix: 'admin.', label: 'audit.area.admin' },
  { prefix: 'impersonation.', label: 'audit.area.impersonation' },
  { prefix: 'sharing.', label: 'audit.area.sharing' },
  { prefix: 'account.', label: 'audit.area.account' },
  { prefix: 'settings.', label: 'audit.area.settings' },
  { prefix: 'backup.', label: 'audit.area.backup' },
  { prefix: 'server.', label: 'audit.area.server' },
  { prefix: 'logs.', label: 'audit.area.logs' },
];

const OUTCOMES = ['ok', 'failed', 'denied', 'refused', 'locked', 'throttled', 'pending', 'error'];

const OUTCOME_COLOR: Record<string, string> = {
  ok: 'success.main',
  pending: 'info.main',
  failed: 'warning.main',
  refused: 'warning.main',
  throttled: 'warning.main',
  locked: 'error.main',
  denied: 'error.main',
  error: 'error.main',
};

function Row({ entry, when }: { entry: AuditEntry; when: (iso: string) => string }) {
  const [open, setOpen] = useState(false);
  const access = entry.kind === 'access';
  const title = access
    ? `${entry.method ?? ''} ${entry.route ?? ''} ${entry.status ?? ''}`.trim()
    : describe(entry);
  const facts = [
    access ? null : entry.detail,
    when(entry.time),
    access ? (entry.actorName ?? t('audit.anonymous')) : null,
    access && entry.durationMs !== null ? t('audit.ms', { ms: entry.durationMs }) : null,
    entry.ip,
    deviceName(entry.device),
    entry.impersonatorName ? t('audit.viewedAsBy', { name: entry.impersonatorName }) : null,
  ].filter((each): each is string => Boolean(each));
  const details: [string, string | number | null][] = [
    [t('audit.field.type'), entry.type],
    [t('audit.field.outcome'), t(`audit.outcome.${entry.outcome}` as MessageKey)],
    [t('audit.field.actor'), entry.actorName],
    [t('audit.field.target'), entry.targetName ?? entry.targetId],
    [t('audit.field.viewedAsBy'), entry.impersonatorName],
    [t('audit.field.detail'), entry.detail],
    [t('audit.field.route'), entry.route ? `${entry.method ?? ''} ${entry.route}` : null],
    [t('audit.field.status'), entry.status],
    [t('audit.field.ip'), entry.ip],
    [t('audit.field.device'), entry.device],
    [t('audit.field.request'), entry.requestId],
  ];
  return (
    <Box role="listitem" aria-label={title}>
      <Box
        component="button"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        sx={{
          all: 'unset',
          boxSizing: 'border-box',
          width: '100%',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 1.5,
          px: 1,
          py: 0.75,
          borderRadius: 2,
          cursor: 'pointer',
          '&:hover': { bgcolor: 'action.hover' },
          '&:focus-visible': { outline: 2, outlineColor: 'primary.main' },
        }}
      >
        <Box
          aria-hidden
          sx={{
            width: 8,
            height: 8,
            mt: 1,
            flexShrink: 0,
            borderRadius: '50%',
            bgcolor: OUTCOME_COLOR[entry.outcome] ?? 'text.disabled',
          }}
        />
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography noWrap>
            {title}
            {!access && entry.outcome !== 'ok' && (
              <Typography component="span" color="text.secondary">
                {` · ${t(`audit.outcome.${entry.outcome}` as MessageKey)}`}
              </Typography>
            )}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div" noWrap>
            {facts.join(' · ')}
          </Typography>
        </Box>
      </Box>
      {open && (
        <Box
          component="dl"
          sx={{
            m: 0,
            ml: 4,
            mb: 1,
            display: 'grid',
            gridTemplateColumns: 'max-content 1fr',
            columnGap: 2,
            rowGap: 0.25,
          }}
        >
          {details
            .filter(([, value]) => value !== null && value !== '')
            .map(([label, value]) => (
              <Box key={label} sx={{ display: 'contents' }}>
                <Typography component="dt" variant="caption" color="text.secondary">
                  {label}
                </Typography>
                <Typography component="dd" variant="caption" sx={{ m: 0, wordBreak: 'break-word' }}>
                  {value}
                </Typography>
              </Box>
            ))}
        </Box>
      )}
    </Box>
  );
}

/** A date input's day as the start of that day in this time zone, in UTC. */
function dayStart(day: string, plusDays = 0): string | undefined {
  if (!day) return undefined;
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, date + plusDays).toISOString();
}

/**
 * The event log or the access log (spec: Access and event log): search, filters, entries newest
 * first a page at a time, each opening to its details, and the filtered set as CSV.
 */
export function AuditView({ api, kind }: { api: AdminApi; kind: AuditKind }) {
  const today = useToday();
  const when = (iso: string) => formatWhen(localDateTimeOf(iso, localTimeZone()), today);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [outcome, setOutcome] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [more, setMore] = useState(false);
  const [user, setUser] = useState('');
  const [ip, setIp] = useState('');
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // Typing settles for a moment before it searches.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);

  const query: AuditQuery = {
    kind,
    text: search || undefined,
    type: type || undefined,
    outcome: outcome || undefined,
    user: user.trim() || undefined,
    ip: ip.trim() || undefined,
    from: dayStart(from),
    to: dayStart(to, 1),
  };
  const key = JSON.stringify(query);

  useEffect(() => {
    let live = true;
    void api.audit({ ...(JSON.parse(key) as AuditQuery), limit: PAGE }).then((page) => {
      if (!live) return;
      setEntries(page.entries);
      setHasMore(page.more);
    });
    return () => {
      live = false;
    };
  }, [api, key]);

  const loadMore = async () => {
    const page = await api.audit({ ...query, offset: entries?.length ?? 0, limit: PAGE });
    setEntries([...(entries ?? []), ...page.entries]);
    setHasMore(page.more);
  };

  const field = {
    size: 'small' as const,
    sx: { minWidth: 140, flex: { xs: '1 1 140px', sm: '0 0 auto' } },
  };
  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        <TextField
          size="small"
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('audit.search')}
          slotProps={{ htmlInput: { 'aria-label': t('audit.search') } }}
          sx={{ flex: '1 1 200px' }}
        />
        {kind === 'event' && (
          <TextField
            {...field}
            select
            label={t('audit.filter.type')}
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            <MenuItem value="">{t('audit.filter.any')}</MenuItem>
            {AREAS.map((area) => (
              <MenuItem key={area.prefix} value={area.prefix}>
                {t(area.label)}
              </MenuItem>
            ))}
          </TextField>
        )}
        <TextField
          {...field}
          select
          label={t('audit.filter.outcome')}
          value={outcome}
          onChange={(event) => setOutcome(event.target.value)}
        >
          <MenuItem value="">{t('audit.filter.any')}</MenuItem>
          {OUTCOMES.map((each) => (
            <MenuItem key={each} value={each}>
              {t(`audit.outcome.${each}` as MessageKey)}
            </MenuItem>
          ))}
        </TextField>
        <Button size="small" onClick={() => setMore(!more)} aria-expanded={more}>
          {t('audit.moreFilters')}
        </Button>
      </Box>
      {more && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          <TextField
            {...field}
            label={t('audit.filter.user')}
            value={user}
            onChange={(event) => setUser(event.target.value)}
          />
          <TextField
            {...field}
            label={t('audit.filter.ip')}
            value={ip}
            onChange={(event) => setIp(event.target.value)}
          />
          <TextField
            {...field}
            type="date"
            label={t('audit.filter.from')}
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            {...field}
            type="date"
            label={t('audit.filter.to')}
            value={to}
            onChange={(event) => setTo(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Box>
      )}
      <Box role="list" aria-label={kind === 'event' ? t('audit.events') : t('audit.requests')}>
        {(entries ?? []).map((entry) => (
          <Row key={entry.id} entry={entry} when={when} />
        ))}
        {entries?.length === 0 && (
          <Typography color="text.secondary" sx={{ px: 1 }}>
            {t('audit.none')}
          </Typography>
        )}
      </Box>
      <Box sx={{ display: 'flex', gap: 1 }}>
        {hasMore && (
          <Button size="small" onClick={() => void loadMore()}>
            {t('audit.loadMore')}
          </Button>
        )}
        <Button size="small" href={api.auditCsvUrl(query)} download>
          {t('audit.csv')}
        </Button>
      </Box>
    </Box>
  );
}
