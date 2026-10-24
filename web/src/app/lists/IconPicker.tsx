import { Box, ButtonBase, InputBase, Typography, useTheme } from '@mui/material';
import { ensureContrast, WCAG_UI } from '../../core/palette.ts';
import { t } from '../i18n/i18n.ts';
import { LIST_ICONS, firstGrapheme } from './listIcons.ts';
import { LIST_SYMBOLS, SYMBOL_PREFIX } from './listSymbols.ts';

const CELL = 34;

/**
 * An icon for a list: none (its color as a dot), a line icon in its color, one of the common
 * emoji, or any other emoji typed in.
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
  const custom =
    value !== null &&
    !value.startsWith(SYMBOL_PREFIX) &&
    !LIST_ICONS.some((each) => each === value);
  const grid = { display: 'grid', gridTemplateColumns: `repeat(auto-fill, ${CELL}px)`, gap: 0.5 };
  return (
    <Box role="radiogroup" aria-label={t('list.icon')}>
      <Box sx={grid}>
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
        {Object.entries(LIST_SYMBOLS).map(([name, Symbol]) => {
          const key = `${SYMBOL_PREFIX}${name}`;
          return (
            <ButtonBase
              key={key}
              role="radio"
              aria-checked={value === key}
              aria-label={t('list.symbol', { name })}
              onClick={() => onChange(key)}
              sx={{
                width: CELL,
                height: CELL,
                borderRadius: 1.5,
                color: tint,
                boxShadow: value === key ? ring : 'none',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Symbol sx={{ fontSize: 20 }} />
            </ButtonBase>
          );
        })}
      </Box>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1.5, mb: 1 }}>
        {t('list.emoji')}
      </Typography>
      <Box sx={grid}>
        {LIST_ICONS.map((icon) => (
          <ButtonBase
            key={icon}
            role="radio"
            aria-checked={value === icon}
            aria-label={icon}
            onClick={() => onChange(icon)}
            sx={{
              width: CELL,
              height: CELL,
              borderRadius: 1.5,
              fontSize: '1.15rem',
              boxShadow: value === icon ? ring : 'none',
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            {icon}
          </ButtonBase>
        ))}
      </Box>
      <InputBase
        placeholder={t('list.otherIcon')}
        value={custom ? value : ''}
        onChange={(event) => onChange(firstGrapheme(event.target.value))}
        inputProps={{ 'aria-label': t('list.otherIcon'), maxLength: 16 }}
        sx={{
          mt: 1,
          px: 1.5,
          py: 0.25,
          width: '100%',
          borderRadius: 1.5,
          bgcolor: 'action.hover',
          boxShadow: custom ? ring : 'none',
        }}
      />
    </Box>
  );
}
