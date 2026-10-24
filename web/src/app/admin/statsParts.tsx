import { Box, Typography } from '@mui/material';
import type { MonthCount } from '../../ports/stats.ts';
import { t } from '../i18n/i18n.ts';

/** "Oct" for "2026-10". */
function monthName(month: string): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  return new Date(year, number - 1, 1).toLocaleDateString(undefined, { month: 'short' });
}

/** Closed tasks per month as bars, oldest first; each bar names its month and count. */
export function MonthBars({ months, label }: { months: MonthCount[]; label: string }) {
  const most = Math.max(1, ...months.map((each) => each.closed));
  return (
    <Box
      role="list"
      aria-label={label}
      sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5, height: 120, pt: 1 }}
    >
      {months.map((each) => {
        const text = t('stats.monthBar', { month: monthName(each.month), count: each.closed });
        return (
          <Box
            key={each.month}
            role="listitem"
            aria-label={text}
            title={text}
            sx={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              height: '100%',
            }}
          >
            <Box sx={{ flexGrow: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
              <Box
                sx={{
                  width: '100%',
                  height: `${(each.closed / most) * 100}%`,
                  minHeight: each.closed > 0 ? 2 : 0,
                  bgcolor: 'primary.main',
                  opacity: 0.8,
                  borderRadius: '3px 3px 0 0',
                }}
              />
            </Box>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontSize: 10, lineHeight: 1.6 }}
            >
              {monthName(each.month)}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}

/** One number with its name, for the totals. */
export function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Box
      role="group"
      aria-label={label}
      sx={{ border: 1, borderColor: 'divider', borderRadius: 2, px: 1.5, py: 1, minWidth: 0 }}
    >
      <Typography variant="h6" component="div" sx={{ lineHeight: 1.3 }}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary" noWrap component="div">
        {label}
      </Typography>
    </Box>
  );
}
