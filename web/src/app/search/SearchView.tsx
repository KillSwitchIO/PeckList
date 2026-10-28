import SearchRounded from '@mui/icons-material/SearchRounded';
import { alpha, Box, InputBase, Typography } from '@mui/material';
import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { searchTasks, type Range, type SearchHit } from '../../core/search.ts';
import { t } from '../i18n/i18n.ts';
import { eggFor, hatch } from '../fun/eggs.ts';
import { Page } from '../layout/Page.tsx';
import { useWorkspace } from '../store/hooks.ts';
import { TaskRow } from '../tasks/TaskRow.tsx';
import { EmptyState } from '../views/EmptyState.tsx';
import { GroupSection } from '../views/GroupSection.tsx';
import { useReveal } from '../views/useReveal.tsx';

/** How long typing must pause before the results (and the address) follow. */
const SETTLE_MS = 150;

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
  // A screenful at once, the rest as they scroll near: a phone stays quick to type on.
  const { shown, spacer } = useReveal(hits.length, 25, 50);
  return (
    <Box
      component="ul"
      {...(label ? { 'aria-label': label } : {})}
      sx={{ listStyle: 'none', m: 0, p: 0 }}
    >
      {hits.slice(0, shown).map((hit) => (
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
      {spacer && <li aria-hidden>{spacer}</li>}
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
  const inAddress = params.get('q') ?? '';
  // The field answers every key at once; only it re-renders while typing. Once typing pauses the
  // search runs and the address follows (R-FB-145): writing the address on each key re-rendered
  // the whole app shell, and searching and drawing 200 rows each time held keys up on a phone.
  const [text, setText] = useState(inAddress);
  const [settled, setSettled] = useState(inAddress);
  // What this page last wrote to the address: its own writes coming back are not navigation.
  const [written, setWritten] = useState(inAddress);
  useEffect(() => {
    if (text === settled) return;
    const timer = setTimeout(() => startTransition(() => setSettled(text)), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [text, settled]);
  useEffect(() => {
    if (settled === inAddress) return;
    startTransition(() => {
      setWritten(settled);
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (settled) next.set('q', settled);
          else next.delete('q');
          return next;
        },
        { replace: true },
      );
    });
    // Only for a new settled query: the address catching up must not write it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled]);
  // Back and forward (or a link) bring another query: the field follows.
  const [seen, setSeen] = useState(inAddress);
  if (inAddress !== seen) {
    setSeen(inAddress);
    if (inAddress !== settled && inAddress !== written) {
      setText(inAddress);
      setSettled(inAddress);
    }
  }
  const deferred = useDeferredValue(settled);
  const hits = useMemo(() => searchTasks(workspace, deferred), [workspace, deferred]);
  // A few words hide a surprise (R-FB-122).
  const egg = eggFor(deferred);
  useEffect(() => {
    if (egg) hatch(egg);
  }, [egg]);
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
          value={text}
          placeholder={t('search.placeholder')}
          onChange={(event) => setText(event.target.value)}
          inputProps={{ 'aria-label': t('search.label'), type: 'search' }}
        />
      </Box>
      {deferred.trim() === '' ? (
        <EmptyState title={t('search.prompt')} hint={t('search.hint')} />
      ) : hits.length === 0 ? (
        <EmptyState title={t('search.none', { query: deferred.trim() })} />
      ) : (
        <>
          <ResultRows key={deferred} hits={open} label={t('search.results')} />
          {closed.length > 0 && (
            <GroupSection groupKey="completed" title={t('nav.completed')} count={closed.length}>
              <ResultRows key={deferred} hits={closed} />
            </GroupSection>
          )}
        </>
      )}
    </Page>
  );
}
