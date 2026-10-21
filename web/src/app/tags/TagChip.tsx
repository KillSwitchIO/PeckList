import { Box, useTheme } from '@mui/material';
import { chipColors } from '../../core/palette.ts';
import { leafName } from '../../core/tags.ts';
import type { Tag } from '../../core/types.ts';
import { t } from '../i18n/i18n.ts';

/** Small tinted pill with the tag's last name segment (`home/yard` shows `yard`). */
export function TagChip({ tag }: { tag: Tag }) {
  const theme = useTheme();
  const { bg, fg } = chipColors(tag.color, theme.palette.mode);
  return (
    <Box
      component="span"
      title={tag.name}
      sx={{
        display: 'inline-block',
        maxWidth: 112,
        px: 0.875,
        lineHeight: '20px',
        borderRadius: '10px',
        bgcolor: bg,
        color: fg,
        typography: 'caption',
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

/** Tag pills in a row; past `max`, a muted "+N" stands in for the rest. */
export function TagChips({ tags, max }: { tags: Tag[]; max?: number }) {
  if (tags.length === 0) return null;
  const shown = max === undefined ? tags : tags.slice(0, max);
  const hidden = tags.length - shown.length;
  return (
    <Box
      component="span"
      data-testid="task-tags"
      sx={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5 }}
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
