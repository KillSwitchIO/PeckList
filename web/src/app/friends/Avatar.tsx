import { Box } from '@mui/material';
import { useState } from 'react';
import { initialsOf } from './initials.ts';

/**
 * A person as round initials on their color. `badge`: an icon in the bottom right (the identity
 * provider they signed in with); it stays away when the image does not load.
 */
export function Avatar({
  name,
  color,
  size = 32,
  badge,
}: {
  name: string;
  color: string;
  size?: number;
  badge?: string | null | undefined;
}) {
  const [badgeFailed, setBadgeFailed] = useState(false);
  const letters = initialsOf(name);
  return (
    <Box
      aria-hidden
      sx={{
        position: 'relative',
        width: size,
        height: size,
        borderRadius: '50%',
        bgcolor: color,
        color: 'rgba(0, 0, 0, 0.7)',
        display: 'grid',
        placeItems: 'center',
        fontSize: size * (letters.length > 1 ? 0.38 : 0.44),
        fontWeight: 600,
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {letters}
      {badge && !badgeFailed && (
        <Box
          component="img"
          src={badge}
          alt=""
          data-testid="provider-badge"
          onError={() => setBadgeFailed(true)}
          sx={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            width: Math.max(12, Math.round(size * 0.42)),
            height: Math.max(12, Math.round(size * 0.42)),
            borderRadius: '50%',
            bgcolor: 'background.paper',
            border: 1.5,
            borderColor: 'background.paper',
            objectFit: 'contain',
          }}
        />
      )}
    </Box>
  );
}
