import SearchRounded from '@mui/icons-material/SearchRounded';
import { alpha, Box, InputBase, Typography } from '@mui/material';
import { useDeferredValue } from 'react';
import { useSearchParams } from 'react-router';
import { searchTasks, type Range, type SearchHit } from '../../core/search.ts';
import { t } from '../i18n/i18n.ts';
import { Page } from '../layout/Page.tsx';
import { useWorkspace } from '../store/hooks.ts';
import { TaskRow } from '../tasks/TaskRow.tsx';
import { EmptyState } from '../views/EmptyState.tsx';
import { GroupSection } from '../views/GroupSection.tsx';

/** Text with its matches marked. */
function Highlighted({ text, ranges }: { text: string; ranges: readonly Range[] }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach(([start, end], index) => {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <Box
        key={index}
        component="mark"
        sx={{
          // A light wash of the accent: the text stays readable in both themes.
          bgcolor: (theme) => alpha(theme.palette.primary.main, 0.22),
          color: 'inherit',
          borderRadius: 0.5,
          px: '1px',
        }}
      >
        {text.slice(start, end)}
      </Box>,
    );
    at = end;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

/**
 * Results as rows like every other task list (R-FB-111): the same row, its list, date, tags and
 * actions. A match in the notes adds a line under it with the words marked.
 */
function ResultRows({ hits, label }: { hits: SearchHit[]; label?: string }) {
  return (
    <Box
      component="ul"
      {...(label ? { 'aria-label': label } : {})}
      sx={{ listStyle: 'none', m: 0, p: 0 }}
    >
      {hits.map((hit) => (
        <li key={hit.task.id}>
          <TaskRow task={hit.task} showList showParent />
          {hit.snippet && (
            <Typography
              variant="body2"
              color="text.secondary"
              noWrap
              sx={{ pl: 6, pr: 1.5, mt: -0.5, pb: 0.75, fontSize: '0.8125rem' }}
            >
              <Highlighted text={hit.snippet.text} ranges={hit.snippet.ranges} />
            </Typography>
          )}
        </li>
      ))}
    </Box>
  );
}

/**
 * Search (spec: PL-017): titles, notes and tag names, every word must match. The query lives in
 * the address (`/search?q=`), so back and forward and reloads keep it.
 */
export function SearchView() {
  const workspace = useWorkspace();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  // Typing stays quick on big workspaces: results follow a moment behind.
  const deferred = useDeferredValue(query);
  const hits = searchTasks(workspace, deferred);
  const open = hits.filter((hit) => hit.task.status === 'open');
  const closed = hits.filter((hit) => hit.task.status !== 'open');

  return (
    <Page title={t('nav.search')}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 0.75,
          mb: 2,
          border: 1,
          borderColor: 'divider',
          borderRadius: 2,
          '&:focus-within': { borderColor: 'primary.main' },
        }}
      >
        <SearchRounded fontSize="small" sx={{ color: 'text.secondary' }} />
        <InputBase
          autoFocus
          fullWidth
          value={query}
          placeholder={t('search.placeholder')}
          onChange={(event) =>
            setParams(
              (current) => {
                const next = new URLSearchParams(current);
                if (event.target.value) next.set('q', event.target.value);
                else next.delete('q');
                return next;
              },
              { replace: true },
            )
          }
          inputProps={{ 'aria-label': t('search.label'), type: 'search' }}
        />
      </Box>
      {deferred.trim() === '' ? (
        <EmptyState title={t('search.prompt')} hint={t('search.hint')} />
      ) : hits.length === 0 ? (
        <EmptyState title={t('search.none', { query: deferred.trim() })} />
      ) : (
        <>
          <ResultRows hits={open} label={t('search.results')} />
          {closed.length > 0 && (
            <GroupSection groupKey="completed" title={t('nav.completed')} count={closed.length}>
              <ResultRows hits={closed} />
            </GroupSection>
          )}
        </>
      )}
    </Page>
  );
}
