import { Alert, Box, Button, Typography } from '@mui/material';
import { useState, type ReactNode } from 'react';
import type { AdminApi } from '../../ports/admin.ts';
import { localDateTimeOf, localTimeZone } from '../../core/dates.ts';
import { formatWhen } from '../format.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { ConfirmDialog } from './AdminDialogs.tsx';
import { useLoaded } from './useAdmin.ts';

/** How long a migration window opened here stays open. */
const WINDOW_HOURS = 24;

function Row({ title, detail, children }: { title: string; detail: string; children?: ReactNode }) {
  return (
    <Box
      role="listitem"
      aria-label={title}
      sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 1, borderRadius: 2 }}
    >
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography noWrap>{title}</Typography>
        <Typography variant="caption" color="text.secondary" component="div">
          {detail}
        </Typography>
      </Box>
      {children}
    </Box>
  );
}

/** Admin > Sign-in: identity providers, moving between them, and people waiting to be let in. */
export function SignInTab({ api }: { api: AdminApi }) {
  const today = useToday();
  const providers = useLoaded(api.providers);
  const pending = useLoaded(api.pending);
  const [notice, setNotice] = useState<string | null>(null);
  const [unbinding, setUnbinding] = useState<{ name: string; displayName: string } | null>(null);
  const when = (iso: string) => formatWhen(localDateTimeOf(iso, localTimeZone()), today);

  return (
    <Box sx={{ maxWidth: 720, display: 'grid', gap: 3 }}>
      {notice && (
        <Alert severity="info" variant="outlined" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      <Box component="section" aria-label={t('admin.signIn.providers')}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
          {t('admin.signIn.providers')}
        </Typography>
        <Box role="list">
          {(providers.data ?? []).map((provider) => (
            <Row
              key={provider.name}
              title={provider.displayName}
              detail={[
                t('admin.signIn.linked', { count: provider.linked }),
                ...(provider.migrationWindowUntil
                  ? [t('admin.signIn.windowOpen', { time: when(provider.migrationWindowUntil) })]
                  : []),
              ].join(' · ')}
            >
              {provider.migrationWindowUntil ? (
                <Button
                  size="small"
                  onClick={() =>
                    void api.closeMigrationWindow(provider.name).then(providers.reload)
                  }
                >
                  {t('admin.signIn.closeWindow')}
                </Button>
              ) : (
                <Button
                  size="small"
                  onClick={() =>
                    void api.openMigrationWindow(provider.name, WINDOW_HOURS).then(() => {
                      setNotice(t('admin.signIn.windowHint', { provider: provider.displayName }));
                      providers.reload();
                    })
                  }
                >
                  {t('admin.signIn.openWindow')}
                </Button>
              )}
              <Button
                size="small"
                color="error"
                disabled={provider.linked === 0}
                onClick={() => setUnbinding(provider)}
              >
                {t('admin.signIn.unbindAll')}
              </Button>
            </Row>
          ))}
          {providers.data?.length === 0 && (
            <Typography color="text.secondary" sx={{ px: 1 }}>
              {t('admin.signIn.noProviders')}
            </Typography>
          )}
        </Box>
      </Box>

      <Box component="section" aria-label={t('admin.signIn.waiting')}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
          {t('admin.signIn.waiting')}
        </Typography>
        <Box role="list">
          {(pending.data ?? []).map((each) => (
            <Row
              key={`${each.provider}:${each.subject}`}
              title={each.displayName ? `${each.displayName} (${each.username})` : each.username}
              detail={[each.provider, each.email, ...each.groups].filter(Boolean).join(' · ')}
            >
              <Button
                size="small"
                variant="outlined"
                onClick={() => void api.approve(each.provider, each.subject).then(pending.reload)}
              >
                {t('admin.signIn.approve')}
              </Button>
              <Button
                size="small"
                onClick={() => void api.dismiss(each.provider, each.subject).then(pending.reload)}
              >
                {t('admin.signIn.dismiss')}
              </Button>
            </Row>
          ))}
          {pending.data?.length === 0 && (
            <Typography color="text.secondary" sx={{ px: 1 }}>
              {t('admin.signIn.nobodyWaiting')}
            </Typography>
          )}
        </Box>
      </Box>

      <ConfirmDialog
        confirm={
          unbinding && {
            title: t('admin.signIn.unbindTitle', { provider: unbinding.displayName }),
            text: t('admin.signIn.unbindText'),
            action: t('admin.signIn.unbindAll'),
            run: () =>
              void api.unbindAll(unbinding.name).then((result) => {
                setNotice(
                  result.stranded.length > 0
                    ? t('admin.signIn.unboundStranded', {
                        count: result.unbound,
                        names: result.stranded.join(', '),
                      })
                    : t('admin.signIn.unbound', { count: result.unbound }),
                );
                providers.reload();
              }),
          }
        }
        onClose={() => setUnbinding(null)}
      />
    </Box>
  );
}
