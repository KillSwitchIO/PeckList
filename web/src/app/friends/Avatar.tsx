import { Box } from '@mui/material';
import { useState } from 'react';

/** The first letters of the first and last names (Ben Dimit: BD), or of a one-word name. */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/[\s._-]+/u)
    .filter((word) => word.length > 0);
  const first = (word: string | undefined) => (word ? (Array.from(word)[0] ?? '') : '');
  if (words.length === 0) return '?';
  if (words.length === 1) return first(words[0]).toUpperCase();
  return (first(words[0]) + first(words[words.length - 1])).toUpperCase();
}

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
