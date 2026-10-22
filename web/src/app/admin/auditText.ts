import type { AuditEntry } from '../../ports/admin.ts';
import type { MessageKey } from '../i18n/en.ts';
import { t } from '../i18n/i18n.ts';

/** "Firefox on Windows" from a User-Agent; the agent's first word when it is not a browser. */
export function deviceName(agent: string | null): string | null {
  if (!agent) return null;
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /OPR\//.test(agent)
      ? 'Opera'
      : /Firefox\//.test(agent)
        ? 'Firefox'
        : /Chrome\//.test(agent)
          ? 'Chrome'
          : /Safari\//.test(agent)
            ? 'Safari'
            : null;
  const system = /iPhone|iPad/.test(agent)
    ? 'iOS'
    : /Android/.test(agent)
      ? 'Android'
      : /Windows/.test(agent)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(agent)
          ? 'macOS'
          : /CrOS/.test(agent)
            ? 'ChromeOS'
            : /Linux/.test(agent)
              ? 'Linux'
              : null;
  if (browser && system) return t('audit.device', { browser, system });
  return browser ?? agent.split(/[\s/]/)[0] ?? agent;
}

/** One line saying what happened: "sam signed in", "ben changed kim's role". */
export function describe(entry: AuditEntry): string {
  // A failed sign-in has no actor yet: the name it tried.
  const actor =
    entry.actorName ??
    (entry.type.startsWith('auth.') ? entry.targetName : null) ??
    t('audit.someone');
  const target = entry.targetName ?? entry.targetId ?? '';
  const key = `audit.type.${entry.type}` as MessageKey;
  const text = t(key, { actor, target });
  return text === key ? `${entry.type}${target ? ` · ${target}` : ''}` : text;
}
