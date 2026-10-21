import type { List } from '../../core/types.ts';
import { t } from '../i18n/i18n.ts';

/** The name shown for a list. The default list is always shown as the Mess Drawer. */
export function listName(list: Pick<List, 'name' | 'isInbox'>): string {
  return list.isInbox ? t('nav.inbox') : list.name;
}
