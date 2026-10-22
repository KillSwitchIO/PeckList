import SearchRounded from '@mui/icons-material/SearchRounded';
import { alpha, Box, ButtonBase, InputBase, Typography } from '@mui/material';
import { useDeferredValue } from 'react';
import { useSearchParams } from 'react-router';
import { getEntity } from '../../core/collections.ts';
import { searchTasks, type Range, type SearchHit } from '../../core/search.ts';
import { t } from '../i18n/i18n.ts';
import { Page } from '../layout/Page.tsx';
import { listName } from '../lists/listName.ts';
import { useWorkspace } from '../store/hooks.ts';
import { DateButton } from '../tasks/DateButton.tsx';
import { TaskReadOnly, useCanEditTask } from '../tasks/readOnly.ts';
import { useTaskSelection } from '../tasks/selection.ts';
import { PriorityCheckbox } from '../tasks/TaskRow.tsx';
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

function ResultRow({ hit }: { hit: SearchHit }) {
  const workspace = useWorkspace();
  const { selectedId, open } = useTaskSelection();
  const canEdit = useCanEditTask(hit.task);
  const { task } = hit;
  const list = getEntity(workspace, 'lists', task.listId);
  const title = task.title || t('task.untitled');
  const selected = selectedId === task.id;
  return (
    <TaskReadOnly value={!canEdit}>
      <Box
        component="li"
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: selected ? 'action.selected' : 'transparent',
          '&:hover': { bgcolor: selected ? 'action.selected' : 'action.hover' },
        }}
      >
        <Box sx={{ pt: 0.5, pl: 0.5 }}>
          <PriorityCheckbox task={task} />
        </Box>
        <ButtonBase
          onClick={() => open(task.id)}
          aria-label={t('task.open', { title })}
          disableRipple
          sx={{ flexGrow: 1, minWidth: 0, display: 'block', textAlign: 'left', py: 1, pr: 1.5 }}
        >
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5 }}>
            <Typography
              noWrap
              sx={{
                flexGrow: 1,
                color: task.status === 'open' ? 'text.primary' : 'text.disabled',
                textDecoration: task.status === 'wontdo' ? 'line-through' : 'none',
              }}
            >
              <Highlighted text={title} ranges={task.title ? hit.title : []} />
            </Typography>
            {list && !list.isInbox && (
              <Typography variant="body2" color="text.secondary" noWrap sx={{ flexShrink: 0 }}>
                {listName(list)}
              </Typography>
            )}
          </Box>
          {hit.snippet && (
            <Typography variant="body2" color="text.secondary" noWrap>
              <Highlighted text={hit.snippet.text} ranges={hit.snippet.ranges} />
            </Typography>
          )}
        </ButtonBase>
        <Box sx={{ alignSelf: 'stretch', display: 'flex' }}>
          <DateButton task={task} width="7rem" />
        </Box>
      </Box>
    </TaskReadOnly>
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
          <Box
            component="ul"
            aria-label={t('search.results')}
            sx={{ listStyle: 'none', m: 0, p: 0 }}
          >
            {open.map((hit) => (
              <ResultRow key={hit.task.id} hit={hit} />
            ))}
          </Box>
          {closed.length > 0 && (
            <GroupSection title={t('nav.completed')} count={closed.length}>
              <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                {closed.map((hit) => (
                  <ResultRow key={hit.task.id} hit={hit} />
                ))}
              </Box>
            </GroupSection>
          )}
        </>
      )}
    </Page>
  );
}
