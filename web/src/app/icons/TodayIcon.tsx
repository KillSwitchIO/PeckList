import { Box, SvgIcon, type SvgIconProps } from '@mui/material';
import { useToday } from '../hooks/useToday.ts';

const SIZES = { small: '1.25rem', medium: '1.5rem', large: '2.1875rem', inherit: 'inherit' };

/**
 * Today: a calendar page showing today's day of the month (R-FB-116), in the style of the other
 * icons. It turns over at midnight while the app is open. The number is drawn by CSS, so it is not
 * part of the label next to it (the icon is decoration, as the others are).
 */
export function TodayIcon({ fontSize = 'medium', sx, ...props }: SvgIconProps) {
  const day = Number(useToday().slice(8));
  return (
    <Box
      component="span"
      aria-hidden
      data-day={day}
      sx={{
        position: 'relative',
        display: 'inline-flex',
        flexShrink: 0,
        fontSize: SIZES[fontSize as keyof typeof SIZES] ?? fontSize,
        '&::after': {
          content: 'attr(data-day)',
          position: 'absolute',
          left: 0,
          right: 0,
          top: '43%',
          textAlign: 'center',
          fontSize: day > 9 ? '0.36em' : '0.4em',
          fontWeight: 700,
          lineHeight: 1,
          letterSpacing: '-0.02em',
        },
        ...sx,
      }}
    >
      <SvgIcon {...props} fontSize="inherit">
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3.5" y="4.5" width="17" height="16" rx="2.5" />
          <path d="M3.5 9h17M8 2.75v3.5M16 2.75v3.5" />
        </g>
      </SvgIcon>
    </Box>
  );
}
