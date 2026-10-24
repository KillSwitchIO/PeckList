import type { AdminInvite } from '../../ports/admin.ts';
import { t } from '../i18n/i18n.ts';

function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "1 of 3 used · until Oct 30 · ana": how much is left, when it ends, who came in on it. */
export function describeInvite(invite: AdminInvite): string {
  const parts = [
    invite.maxUses === null
      ? t('admin.invites.usedAny', { count: invite.uses })
      : t('admin.invites.used', { count: invite.uses, max: invite.maxUses }),
    t('admin.invites.until', { date: day(invite.expires) }),
  ];
  if (invite.usedBy.length > 0) parts.push(invite.usedBy.join(', '));
  return parts.join(' · ');
}

/** "5 people until Oct 30": who a new invite is good for. */
export function inviteReach(invite: AdminInvite): string {
  const who =
    invite.maxUses === null
      ? t('admin.invites.anyNumber').toLowerCase()
      : t(invite.maxUses === 1 ? 'admin.invites.onePerson' : 'admin.invites.people', {
          count: invite.maxUses,
        });
  return t('admin.invites.reach', { who, date: day(invite.expires) });
}
