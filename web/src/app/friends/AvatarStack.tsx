import { Box } from '@mui/material';
import type { Assignee } from '../../core/sharing.ts';
import { Avatar } from './Avatar.tsx';

/** People as overlapping avatars, the first few only (task rows, the Assigned row). */
export function AvatarStack({
  people,
  size,
  max = 3,
}: {
  people: Assignee[];
  size: number;
  max?: number;
}) {
  return (
    <Box sx={{ display: 'flex', flexShrink: 0, '& > * + *': { ml: `${-size / 3}px` } }}>
      {people.slice(0, max).map((each) => (
        <Box
          key={each.principal}
          sx={{
            borderRadius: '50%',
            boxShadow: (theme) => `0 0 0 1.5px ${theme.palette.background.paper}`,
          }}
        >
          <Avatar name={each.name} color={each.color} size={size} photo={each.user?.photo} />
        </Box>
      ))}
    </Box>
  );
}
