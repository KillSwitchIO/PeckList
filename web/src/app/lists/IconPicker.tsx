import { Box, ButtonBase, InputBase, useTheme } from '@mui/material';
import { t } from '../i18n/i18n.ts';
import { LIST_ICONS, firstGrapheme } from './listIcons.ts';

const CELL = 34;

/** An icon for a list: none, one of the common emoji, or any other typed in. */
export function IconPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (icon: string | null) => void;
}) {
  const theme = useTheme();
  const ring = `0 0 0 2px ${theme.palette.text.primary}`;
  const custom = value !== null && !LIST_ICONS.some((each) => each === value);
  return (
    <Box>
      <Box
        role="radiogroup"
        aria-label={t('list.icon')}
        sx={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, ${CELL}px)`, gap: 0.5 }}
      >
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
