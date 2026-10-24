import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableSortLabel,
  Typography,
} from '@mui/material';
import { Fragment, useState } from 'react';
import { localDateTimeOf, localTimeZone } from '../../core/dates.ts';
import type { AdminApi } from '../../ports/admin.ts';
import type { UserStats } from '../../ports/stats.ts';
import { formatBytes, formatWhen } from '../format.ts';
import { useToday } from '../hooks/useToday.ts';
import type { MessageKey } from '../i18n/en.ts';
import { t } from '../i18n/i18n.ts';
import { MonthBars, StatCard } from './statsParts.tsx';
import { useLoaded } from './useAdmin.ts';

type Column = keyof Pick<
  UserStats,
  | 'username'
  | 'openTasks'
  | 'closedTasks'
  | 'closedThisMonth'
  | 'createdTasks'
  | 'lists'
  | 'sharedLists'
  | 'storageBytes'
  | 'devices'
  | 'lastActive'
>;

const COLUMNS: { key: Column; label: MessageKey }[] = [
  { key: 'username', label: 'stats.person' },
  { key: 'openTasks', label: 'stats.open' },
  { key: 'closedTasks', label: 'stats.closed' },
  { key: 'closedThisMonth', label: 'stats.closedThisMonth' },
  { key: 'createdTasks', label: 'stats.created' },
  { key: 'lists', label: 'stats.lists' },
  { key: 'sharedLists', label: 'stats.sharedLists' },
  { key: 'storageBytes', label: 'stats.storage' },
  { key: 'devices', label: 'stats.devices' },
  { key: 'lastActive', label: 'stats.lastActive' },
];

/**
 * Admin > Stats (spec: Server stats), in the spirit of Immich's: server totals, closed tasks per
 * month, and a row per person that sorts by any column and opens to their own months. Counts only.
 */
export function StatsTab({ api }: { api: AdminApi }) {
  const { data } = useLoaded(api.stats);
  const today = useToday();
  const [sort, setSort] = useState<{ by: Column; down: boolean }>({ by: 'openTasks', down: true });
  const [open, setOpen] = useState<string | null>(null);
  if (!data) return null;
  const when = (iso: string | null) =>
    iso ? formatWhen(localDateTimeOf(iso, localTimeZone()), today) : t('stats.notSeen');
  const cell = (person: UserStats, key: Column): string => {
    if (key === 'storageBytes') return formatBytes(person.storageBytes);
    if (key === 'lastActive') return when(person.lastActive);
    if (key === 'username') return person.username;
    return person[key].toLocaleString();
  };
  const people = [...data.people].sort((a, b) => {
    const x = a[sort.by] ?? '';
    const y = b[sort.by] ?? '';
    const order =
      typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    return sort.down ? -order : order;
  });
  const cards: [MessageKey, string][] = [
    ['stats.users', data.users.toLocaleString()],
    ['stats.open', data.openTasks.toLocaleString()],
    ['stats.closed', data.closedTasks.toLocaleString()],
    ['stats.closedThisMonth', data.closedThisMonth.toLocaleString()],
    ['stats.lists', data.lists.toLocaleString()],
    ['stats.sharedLists', data.sharedLists.toLocaleString()],
    ['stats.storage', formatBytes(data.storageBytes)],
  ];
  return (
    <Box sx={{ maxWidth: 960, display: 'grid', gap: 3, pb: 10 }}>
      <Box
        component="section"
        aria-label={t('stats.totals')}
        sx={{
          display: 'grid',
          gap: 1,
          gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
        }}
      >
        {cards.map(([label, value]) => (
          <StatCard key={label} label={t(label)} value={value} />
        ))}
      </Box>

      <Box component="section" aria-label={t('stats.byMonth')}>
        <Typography variant="subtitle2" color="text.secondary">
          {t('stats.byMonth')}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {t('stats.timeZone', { zone: data.timeZone })}
        </Typography>
        <MonthBars months={data.closedByMonth} label={t('stats.byMonth')} />
      </Box>

      <Box component="section" aria-label={t('stats.people')}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
          {t('stats.people')}
        </Typography>
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label={t('stats.people')}>
            <TableHead>
              <TableRow>
                {COLUMNS.map((column) => (
                  <TableCell
                    key={column.key}
                    align={column.key === 'username' ? 'left' : 'right'}
                    sortDirection={sort.by === column.key ? (sort.down ? 'desc' : 'asc') : false}
                    sx={{ whiteSpace: 'nowrap' }}
                  >
                    <TableSortLabel
                      active={sort.by === column.key}
                      direction={sort.by === column.key && !sort.down ? 'asc' : 'desc'}
                      onClick={() =>
                        setSort({
                          by: column.key,
                          down: sort.by === column.key ? !sort.down : column.key !== 'username',
                        })
                      }
                    >
                      {t(column.label)}
                    </TableSortLabel>
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {people.map((person) => (
                <Fragment key={person.id}>
                  <TableRow
                    hover
                    onClick={() => setOpen(open === person.id ? null : person.id)}
                    aria-expanded={open === person.id}
                    sx={{ cursor: 'pointer' }}
                  >
                    {COLUMNS.map((column) => (
                      <TableCell
                        key={column.key}
                        align={column.key === 'username' ? 'left' : 'right'}
                        sx={{ whiteSpace: 'nowrap' }}
                      >
                        {cell(person, column.key)}
                      </TableCell>
                    ))}
                  </TableRow>
                  {open === person.id && (
                    <TableRow>
                      <TableCell colSpan={COLUMNS.length}>
                        <MonthBars
                          months={person.closedByMonth}
                          label={t('stats.byMonthOf', { name: person.username })}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </Box>
      </Box>
    </Box>
  );
}
