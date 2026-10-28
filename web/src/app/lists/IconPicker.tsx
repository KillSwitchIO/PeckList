import SearchRounded from '@mui/icons-material/SearchRounded';
import type { SvgIconComponent } from '@mui/icons-material';
import { Box, ButtonBase, InputBase, Typography, useTheme } from '@mui/material';
import { createElement, useEffect, useState, type ReactNode } from 'react';
import { ensureContrast, WCAG_UI } from '../../core/palette.ts';
import { t } from '../i18n/i18n.ts';
import { firstGrapheme, LIST_ICONS } from './listIcons.ts';
import { LIST_SYMBOLS, loadSymbolCatalog, SYMBOL_PREFIX } from './listSymbols.ts';

type Catalog = typeof import('./iconCatalog.ts');

const CELL = 34;
/** Rows in a strip that scrolls sideways: compact, and a swipe shows more (R-FB-117). */
const ROWS = 3;
/** The line icons most lists want, in the top row. */
const COMMON_SYMBOLS = ['list', 'checklist', 'star', 'flag', 'idea', 'work', 'home', 'cart'];

/** Whether every word of `query` starts a word in `words`. */
function matches(query: string, words: string): boolean {
  const haystack = ` ${words.toLowerCase()}`;
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(` ${term}`));
}

/** A row of choices; `strip` lays them out in a few rows that scroll left and right. */
function Cells({ strip, children, label }: { strip: boolean; children: ReactNode; label: string }) {
  return (
    <Box
      role="group"
      aria-label={label}
      sx={{
        display: 'grid',
        gap: 0.5,
        ...(strip
          ? {
              gridAutoFlow: 'column',
              gridTemplateRows: `repeat(${ROWS}, ${CELL}px)`,
              gridAutoColumns: `${CELL}px`,
              overflowX: 'auto',
              overscrollBehaviorX: 'contain',
              scrollbarWidth: 'thin',
              pb: 0.5,
            }
          : { gridTemplateColumns: `repeat(auto-fill, ${CELL}px)` }),
      }}
    >
      {children}
    </Box>
  );
}

/**
 * An icon for a list: none (its color as a dot), a line icon in its color, or an emoji (R-FB-117).
 * A search finds either by name; each set starts with a row of the common ones, the rest in a few
 * rows that scroll sideways. Any emoji not in the catalog can be typed into the search to use it.
 */
export function IconPicker({
  value,
  color,
  onChange,
}: {
  value: string | null;
  /** The list's color, to show the line icons in. */
  color: string;
  onChange: (icon: string | null) => void;
}) {
  const theme = useTheme();
  const ring = `0 0 0 2px ${theme.palette.text.primary}`;
  const tint = ensureContrast(color, theme.palette.background.paper, WCAG_UI);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [query, setQuery] = useState('');
  useEffect(() => {
    let live = true;
    void loadSymbolCatalog()
      .then(() => import('./iconCatalog.ts'))
      .then((loaded) => {
        if (live) setCatalog(loaded);
      });
    return () => {
      live = false;
    };
  }, []);

  const cell = (key: string, label: string, content: ReactNode, tinted = false) => (
    <ButtonBase
      key={key}
      role="radio"
      aria-checked={value === key}
      aria-label={label}
      onClick={() => onChange(key)}
      sx={{
        width: CELL,
        height: CELL,
        borderRadius: 1.5,
        fontSize: '1.15rem',
        ...(tinted ? { color: tint } : {}),
        boxShadow: value === key ? ring : 'none',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      {content}
    </ButtonBase>
  );
  const symbolCell = (name: string, Symbol: SvgIconComponent) =>
    cell(
      `${SYMBOL_PREFIX}${name}`,
      t('list.symbol', { name }),
      createElement(Symbol, { sx: { fontSize: 20 } }),
      true,
    );

  const common: readonly string[] = LIST_ICONS;
  const symbols: [string, SvgIconComponent][] = [
    ...Object.entries(LIST_SYMBOLS),
    ...Object.entries(catalog?.MORE_SYMBOLS ?? {}),
  ];
  const emoji: readonly (readonly [string, string])[] =
    catalog?.EMOJI ?? common.map((each) => [each, ''] as const);
  const searching = query.trim() !== '';
  const words = (name: string) => `${name} ${catalog?.SYMBOL_WORDS[name] ?? ''}`;
  const shownSymbols = searching
    ? symbols.filter(([name]) => matches(query, words(name)))
    : symbols.filter(([name]) => !COMMON_SYMBOLS.includes(name));
  const shownEmoji = searching
    ? emoji.filter(([each, found]) => each === query.trim() || matches(query, found))
    : emoji.filter(([each]) => !common.includes(each));
  // An emoji typed into the search that the catalog lacks: offered as it is.
  const typed = firstGrapheme(query);
  const typedEmoji =
    typed && /\p{Extended_Pictographic}/u.test(typed) && !emoji.some(([each]) => each === typed)
      ? typed
      : null;
  // The list's own emoji from before, kept on show and picked.
  const custom =
    value !== null &&
    !value.startsWith(SYMBOL_PREFIX) &&
    !common.includes(value) &&
    !emoji.some(([each]) => each === value)
      ? value
      : null;

  const heading = (text: string) => (
    <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1.5, mb: 0.75 }}>
      {text}
    </Typography>
  );
  const nothing = (
    <Typography variant="body2" color="text.disabled">
      {t('list.noMatch')}
    </Typography>
  );

  return (
    <Box role="radiogroup" aria-label={t('list.icon')}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 0.25,
          borderRadius: 1.5,
          bgcolor: 'action.hover',
        }}
      >
        <SearchRounded fontSize="small" sx={{ color: 'text.secondary' }} />
        <InputBase
          fullWidth
          placeholder={t('list.searchIcons')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          inputProps={{ 'aria-label': t('list.searchIcons'), type: 'search', maxLength: 40 }}
        />
      </Box>

      {heading(t('list.icons'))}
      {!searching && (
        <Box sx={{ mb: 0.5 }}>
          <Cells strip={false} label={t('list.commonIcons')}>
            <ButtonBase
              role="radio"
              aria-checked={value === null}
              aria-label={t('list.noIcon')}
              onClick={() => onChange(null)}
              sx={{
                width: CELL,
                height: CELL,
                borderRadius: 1.5,
                typography: 'caption',
                color: 'text.secondary',
                boxShadow: value === null ? ring : 'none',
              }}
            >
              {t('list.noIconShort')}
            </ButtonBase>
            {COMMON_SYMBOLS.map((name) => symbolCell(name, LIST_SYMBOLS[name]!))}
          </Cells>
        </Box>
      )}
      {shownSymbols.length > 0 ? (
        <Cells strip label={t('list.icons')}>
          {shownSymbols.map(([name, Symbol]) => symbolCell(name, Symbol))}
        </Cells>
      ) : (
        nothing
      )}

      {heading(t('list.emoji'))}
      {!searching && (
        <Box sx={{ mb: 0.5 }}>
          <Cells strip={false} label={t('list.commonEmoji')}>
            {custom && cell(custom, custom, custom)}
            {common.map((each) => cell(each, each, each))}
          </Cells>
        </Box>
      )}
      {typedEmoji && (
        <Box sx={{ mb: 0.5 }}>
          <Cells strip={false} label={t('list.typedEmoji')}>
            {cell(typedEmoji, t('list.useEmoji', { emoji: typedEmoji }), typedEmoji)}
          </Cells>
        </Box>
      )}
      {shownEmoji.length > 0 ? (
        <Cells strip label={t('list.emoji')}>
          {shownEmoji.map(([each]) => cell(each, each, each))}
        </Cells>
      ) : (
        !typedEmoji && nothing
      )}
    </Box>
  );
}
