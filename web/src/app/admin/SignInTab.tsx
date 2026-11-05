import { Alert, Box, Button, FormControlLabel, Switch, Typography } from '@mui/material';
import { useState, type ReactNode } from 'react';
import type { AdminApi, AdminIdentity, OidcOverview, PendingSignIn } from '../../ports/admin.ts';
import { localDateTimeOf, localTimeZone } from '../../core/dates.ts';
import { formatWhen } from '../format.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { ConfirmDialog } from './AdminDialogs.tsx';
import { LinkIdentityDialog } from './LinkIdentityDialog.tsx';
import { MapDialog, MoveDialog } from './OidcDialogs.tsx';
import { SETTINGS_ON } from './settingsGroups.ts';
import { SettingsTab } from './SettingsTab.tsx';
import { useLoaded } from './useAdmin.ts';

/** How long a migration window opened here stays open. */
const WINDOW_HOURS = 24;

function Row({ title, detail, children }: { title: string; detail: string; children?: ReactNode }) {
  return (
    <Box
      role="listitem"
      aria-label={title}
      sx={{ display: 'flex', alignItems: 'center', gap: 1, mx: -1, px: 1, py: 1, borderRadius: 2 }}
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

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Box component="section" aria-label={title}>
      <Typography variant="subtitle2" color="text.secondary">
        {title}
      </Typography>
      {hint && (
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 0.5 }}>
          {hint}
        </Typography>
      )}
      {children}
    </Box>
  );
}

type Account = OidcOverview['accounts'][number];

interface Unlinking {
  account: Account;
  identity: AdminIdentity;
  label: string;
}

/** "Pocket ID: ben", or the email or subject when the provider sent no username. */
function identityLabel(identity: AdminIdentity) {
  return t('admin.signIn.identity', {
    provider: identity.displayName,
    name: identity.username ?? identity.email ?? identity.subject,
  });
}

/**
 * Admin > Sign-in: identity providers, who is paired with which provider account (map, remap,
 * unmap), the mappings, moving between providers, and people waiting to be let in.
 */
export function SignInTab({ api }: { api: AdminApi }) {
  const today = useToday();
  const providers = useLoaded(api.providers);
  const pending = useLoaded(api.pending);
  const [notice, setNotice] = useState<string | null>(null);
  const [unbinding, setUnbinding] = useState<{ name: string; displayName: string } | null>(null);
  const [linking, setLinking] = useState<PendingSignIn | null>(null);
  const overview = useLoaded(api.oidc);
  const [showAll, setShowAll] = useState(false);
  const [mapping, setMapping] = useState<{ account?: string } | null>(null);
  const [moving, setMoving] = useState<(Unlinking & { from: Account }) | null>(null);
  const [unlinking, setUnlinking] = useState<Unlinking | null>(null);
  const when = (iso: string) => formatWhen(localDateTimeOf(iso, localTimeZone()), today);
  const reload = () => {
    overview.reload();
    providers.reload();
    pending.reload();
  };
  const accounts = (overview.data?.accounts ?? []).filter(
    (each) => showAll || each.identities.length > 0,
  );
  const joins = (name: string) => {
    const mode = overview.data?.providers.find((each) => each.name === name)?.linkByUsername;
    if (mode === 'all') return [t('admin.signIn.byUsername')];
    if (mode === 'true') return [t('admin.signIn.byUsernameUsers')];
    return [];
  };

  return (
    <Box sx={{ maxWidth: 720, display: 'grid', gap: 3 }}>
      {notice && (
        <Alert severity="info" variant="outlined" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      <SettingsTab api={api} only={SETTINGS_ON.signIn} />
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
                ...joins(provider.name),
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
            <Typography color="text.secondary">{t('admin.signIn.noProviders')}</Typography>
          )}
        </Box>
      </Box>

      {(providers.data?.length ?? 0) > 0 && overview.data && (
        <>
          <Section title={t('admin.signIn.accounts')} hint={t('admin.signIn.accountsHint')}>
            <FormControlLabel
              control={
                <Switch size="small" checked={showAll} onChange={(_, on) => setShowAll(on)} />
              }
              label={<Typography variant="body2">{t('admin.signIn.showAll')}</Typography>}
              sx={{ ml: 0.5, mb: 0.5 }}
            />
            <Box role="list">
              {accounts.map((account) => (
                <Box
                  key={account.id}
                  role="listitem"
                  aria-label={account.username}
                  sx={{ mx: -1, px: 1, py: 0.75, borderRadius: 2 }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
                      {account.username}
                      {account.role !== 'user' && (
                        <Typography component="span" variant="caption" color="text.secondary">
                          {' · '}
                          {t(`admin.role.${account.role}`)}
                        </Typography>
                      )}
                    </Typography>
                    <Button size="small" onClick={() => setMapping({ account: account.id })}>
                      {t('admin.signIn.map')}
                    </Button>
                  </Box>
                  {account.identities.length === 0 && (
                    <Typography variant="caption" color="text.secondary" component="div">
                      {t('admin.signIn.notLinked')}
                    </Typography>
                  )}
                  {account.identities.map((identity) => {
                    const label = identityLabel(identity);
                    return (
                      <Box
                        key={`${identity.provider}:${identity.subject}`}
                        sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 1.5 }}
                      >
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ flexGrow: 1, minWidth: 0 }}
                          noWrap
                        >
                          {[
                            label,
                            identity.username && identity.email !== identity.username
                              ? identity.email
                              : null,
                            t('admin.signIn.lastUsed', { time: when(identity.lastUsedAt) }),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </Typography>
                        <Button
                          size="small"
                          onClick={() => setMoving({ account, identity, label, from: account })}
                        >
                          {t('admin.signIn.move')}
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          onClick={() => setUnlinking({ account, identity, label })}
                        >
                          {t('admin.signIn.unlink')}
                        </Button>
                      </Box>
                    );
                  })}
                </Box>
              ))}
            </Box>
          </Section>

          <Section title={t('admin.signIn.mappings')} hint={t('admin.signIn.mappingsHint')}>
            <Box role="list">
              {overview.data.mappings.map((each) => {
                const provider =
                  overview.data?.providers.find((one) => one.name === each.provider)?.displayName ??
                  each.provider;
                const to = each.accountId
                  ? each.accountUsername
                  : t('admin.signIn.missingAccount', { name: each.accountUsername });
                return (
                  <Row
                    key={`${each.provider}:${each.providerUsername}`}
                    title={t('admin.signIn.mappingTo', {
                      provider,
                      from: each.providerUsername,
                      to,
                    })}
                    detail={
                      each.source === 'settings'
                        ? t('admin.signIn.fromSettings')
                        : each.createdAt
                          ? when(each.createdAt)
                          : ''
                    }
                  >
                    {each.source === 'admin' && (
                      <Button
                        size="small"
                        onClick={() =>
                          void api
                            .removeMapping(each.provider, each.providerUsername)
                            .then(overview.reload)
                        }
                      >
                        {t('admin.signIn.remove')}
                      </Button>
                    )}
                  </Row>
                );
              })}
              {overview.data.mappings.length === 0 && (
                <Typography color="text.secondary">{t('admin.signIn.noMappings')}</Typography>
              )}
            </Box>
            <Button size="small" sx={{ mt: 0.5 }} onClick={() => setMapping({})}>
              {t('admin.signIn.addMapping')}
            </Button>
          </Section>
        </>
      )}

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
              <Button size="small" onClick={() => setLinking(each)}>
                {t('admin.link.toAccount')}
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
            <Typography color="text.secondary">{t('admin.signIn.nobodyWaiting')}</Typography>
          )}
        </Box>
      </Box>

      {mapping && overview.data && (
        <MapDialog
          api={api}
          overview={overview.data}
          account={mapping.account}
          onClose={() => setMapping(null)}
          onDone={overview.reload}
        />
      )}
      {moving && overview.data && (
        <MoveDialog
          api={api}
          overview={overview.data}
          move={{
            provider: moving.identity.provider,
            subject: moving.identity.subject,
            label: moving.label,
            from: moving.from,
          }}
          onClose={() => setMoving(null)}
          onDone={(stranded) => {
            setNotice(
              stranded.length > 0
                ? t('admin.signIn.moved', { name: stranded.join(', ') })
                : t('admin.signIn.movedOk'),
            );
            reload();
          }}
        />
      )}
      <ConfirmDialog
        confirm={
          unlinking && {
            title: t('admin.signIn.unlinkTitle', { identity: unlinking.label }),
            text: t('admin.signIn.unlinkText'),
            action: t('admin.signIn.unlink'),
            run: () =>
              void api
                .unlink(
                  unlinking.account.id,
                  unlinking.identity.provider,
                  unlinking.identity.subject,
                )
                .then((result) => {
                  if (result.ok) {
                    setNotice(
                      result.value.stranded
                        ? t('admin.signIn.unlinkedStranded', { name: unlinking.account.username })
                        : t('admin.signIn.unlinked'),
                    );
                  }
                  reload();
                }),
          }
        }
        onClose={() => setUnlinking(null)}
      />
      {linking && (
        <LinkIdentityDialog
          api={api}
          waiting={linking}
          onClose={() => setLinking(null)}
          onLinked={(name) => {
            setNotice(t('admin.link.done', { name }));
            reload();
          }}
        />
      )}
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
