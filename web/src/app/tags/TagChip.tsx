import { Box, useTheme } from '@mui/material';
import { chipColors } from '../../core/palette.ts';
import { leafName } from '../../core/tags.ts';
import type { Tag } from '../../core/types.ts';
import { t } from '../i18n/i18n.ts';

/** Small tinted pill with the tag's last name segment (`home/yard` shows `yard`). */
export function TagChip({ tag, size = 'small' }: { tag: Tag; size?: 'small' | 'medium' }) {
  const theme = useTheme();
  const { bg, fg } = chipColors(tag.color, theme.palette.mode);
  return (
    <Box
      component="span"
      title={tag.name}
      sx={{
        display: 'inline-block',
        maxWidth: size === 'medium' ? 180 : 112,
        px: size === 'medium' ? 1.25 : 0.875,
        lineHeight: size === 'medium' ? '24px' : '20px',
        borderRadius: size === 'medium' ? '12px' : '10px',
        bgcolor: bg,
        color: fg,
        typography: size === 'medium' ? 'body2' : 'caption',
        fontWeight: 500,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {leafName(tag.name)}
    </Box>
  );
}

/**
 * Tag pills in a row; past `max`, a muted "+N" stands in for the rest. Rows pass
 * `wrap={false}` so pills stay on one line (clipped) instead of stacking in a narrow cell.
 */
export function TagChips({
  tags,
  max,
  wrap = true,
}: {
  tags: Tag[];
  max?: number;
  wrap?: boolean;
}) {
  if (tags.length === 0) return null;
  const shown = max === undefined ? tags : tags.slice(0, max);
  const hidden = tags.length - shown.length;
  return (
    <Box
      component="span"
      data-testid="task-tags"
      sx={{
        display: 'flex',
        flexWrap: wrap ? 'wrap' : 'nowrap',
        alignItems: 'center',
        gap: 0.5,
        maxWidth: '100%',
        overflow: wrap ? 'visible' : 'hidden',
        '& > *': { flexShrink: 0 },
      }}
    >
      {shown.map((tag) => (
        <TagChip key={tag.id} tag={tag} />
      ))}
      {hidden > 0 && (
        <Box component="span" sx={{ typography: 'caption', color: 'text.secondary' }}>
          {t('tag.more', { count: hidden })}
        </Box>
      )}
    </Box>
  );
}
