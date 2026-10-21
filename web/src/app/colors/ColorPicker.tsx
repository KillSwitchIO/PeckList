import CheckRounded from '@mui/icons-material/CheckRounded';
import { Box, ButtonBase, InputBase, useTheme } from '@mui/material';
import { useState } from 'react';
import { COLOR_FAMILIES, findFamilyColor, type ColorFamily } from '../../core/palette.ts';
import { t } from '../i18n/i18n.ts';

const HUES = [
  'red',
  'orange',
  'yellow',
  'lime',
  'green',
  'teal',
  'blue',
  'violet',
  'pink',
] as const;
const SWATCH = 28;
const HEX = /^#?([0-9a-f]{6})$/i;

function Swatch({
  color,
  label,
  selected,
  onClick,
}: {
  color: string;
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  const theme = useTheme();
  return (
    <ButtonBase
      role="radio"
      aria-checked={selected}
      aria-label={label}
      onClick={onClick}
      sx={{
        width: SWATCH,
        height: SWATCH,
        borderRadius: '50%',
        bgcolor: color,
        color: '#FFFFFF',
        // A ring with a gap reads as "selected" on any color, light or dark.
        boxShadow: selected
          ? `0 0 0 2px ${theme.palette.background.paper}, 0 0 0 4px ${theme.palette.text.primary}`
          : 'none',
        transition: 'box-shadow 120ms',
      }}
    >
      {selected && <CheckRounded sx={{ fontSize: 16, filter: 'drop-shadow(0 0 1px #0008)' }} />}
    </ButtonBase>
  );
}

/**
 * Color choice for lists and tags: a row of families (pastel to vivid), that family's nine
 * colors, and a custom color for anything else.
 */
export function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  const theme = useTheme();
  const spot = findFamilyColor(value);
  const [familyId, setFamilyId] = useState<ColorFamily['id']>(spot?.family.id ?? 'pastel');
  const [customOpen, setCustomOpen] = useState(spot === null);
  const [hexDraft, setHexDraft] = useState(value.toUpperCase());
  const [syncedValue, setSyncedValue] = useState(value);
  // Follow outside changes (a new suggested default) without an effect.
  if (value !== syncedValue) {
    setSyncedValue(value);
    setHexDraft(value.toUpperCase());
    const next = findFamilyColor(value);
    if (next) setFamilyId(next.family.id);
  }
  const family = COLOR_FAMILIES.find((item) => item.id === familyId)!;
  const isCustom = spot === null;

  const commitHex = (text: string) => {
    const match = HEX.exec(text.trim());
    if (match) onChange(`#${match[1]!.toUpperCase()}`);
  };

  return (
    <Box>
      <Box
        role="group"
        aria-label={t('color.families')}
        sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1.25 }}
      >
        {COLOR_FAMILIES.map((item) => {
          const active = item.id === familyId;
          return (
            <ButtonBase
              key={item.id}
              aria-pressed={active}
              onClick={() => setFamilyId(item.id)}
              sx={{
                px: 1.25,
                py: 0.5,
                borderRadius: 999,
                typography: 'body2',
                fontWeight: active ? 600 : 400,
                color: active ? 'text.primary' : 'text.secondary',
                bgcolor: active ? 'action.selected' : 'transparent',
                '&:hover': { bgcolor: active ? 'action.selected' : 'action.hover' },
              }}
            >
              {/* A tiny preview of the family's look */}
              <Box
                component="span"
                aria-hidden
                sx={{
                  width: 10,
                  height: 10,
                  mr: 0.75,
                  borderRadius: '50%',
                  background: `conic-gradient(${item.colors.map((color) => color.hex).join(', ')})`,
                }}
              />
              {t(`color.family.${item.id}`)}
            </ButtonBase>
          );
        })}
      </Box>

      <Box
        role="radiogroup"
        aria-label={t('list.color')}
        sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.25, p: 0.5 }}
      >
        {family.colors.map((color, index) => (
          <Swatch
            key={color.id}
            color={color.hex}
            label={`${t(`color.family.${family.id}`)} ${t(`color.hue.${HUES[index]!}`)}`}
            selected={value.toUpperCase() === color.hex}
            onClick={() => onChange(color.hex)}
          />
        ))}
        <ButtonBase
          role="radio"
          aria-checked={isCustom}
          aria-label={t('color.custom')}
          onClick={() => setCustomOpen(true)}
          sx={{
            width: SWATCH,
            height: SWATCH,
            borderRadius: '50%',
            // Rainbow ring around the custom color (or the paper when none is set).
            background: `radial-gradient(circle, ${isCustom ? value : theme.palette.background.paper} 52%, transparent 54%), conic-gradient(#FF3B30, #FFCC00, #00C46A, #00BFC8, #2F7BFF, #8A4DFF, #FF3D9A, #FF3B30)`,
            boxShadow: isCustom
              ? `0 0 0 2px ${theme.palette.background.paper}, 0 0 0 4px ${theme.palette.text.primary}`
              : 'none',
          }}
        />
      </Box>

      {customOpen && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.25 }}>
          <Box
            component="label"
            sx={{
              position: 'relative',
              width: 36,
              height: 28,
              borderRadius: 1.5,
              bgcolor: value,
              border: 1,
              borderColor: 'divider',
              cursor: 'pointer',
              overflow: 'hidden',
            }}
          >
            <Box
              component="input"
              type="color"
              aria-label={t('color.pick')}
              value={value.toLowerCase()}
              onChange={(event) => onChange(event.target.value.toUpperCase())}
              sx={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
            />
          </Box>
          <InputBase
            value={hexDraft}
            inputProps={{ 'aria-label': t('color.hex'), spellCheck: false, maxLength: 7 }}
            onChange={(event) => {
              setHexDraft(event.target.value);
              commitHex(event.target.value);
            }}
            onBlur={() => setHexDraft(value.toUpperCase())}
            sx={{
              width: 96,
              px: 1,
              py: 0.25,
              borderRadius: 1.5,
              bgcolor: 'action.hover',
              fontFamily: 'ui-monospace, monospace',
              typography: 'body2',
            }}
          />
        </Box>
      )}
    </Box>
  );
}
