import { Box } from '@mui/material';
import { t } from '../i18n/i18n.ts';

/** A small ring filled clockwise from the top to `value` percent. `decorative` hides it from
 * screen readers (when text next to it already says the value). */
export function ProgressRing({
  value,
  size = 14,
  decorative = false,
}: {
  value: number;
  size?: number;
  decorative?: boolean;
}) {
  const radius = 9;
  const circumference = 2 * Math.PI * radius;
  return (
    <Box
      component="svg"
      viewBox="0 0 24 24"
      {...(decorative
        ? { 'aria-hidden': true }
        : { role: 'img', 'aria-label': t('task.progressValue', { percent: value }) })}
      sx={{ width: size, height: size, flexShrink: 0, color: 'primary.main', display: 'block' }}
    >
      <circle
        cx="12"
        cy="12"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.25}
        strokeWidth={3.5}
      />
      <circle
        cx="12"
        cy="12"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={3.5}
        strokeLinecap={value > 0 && value < 100 ? 'round' : 'butt'}
        strokeDasharray={`${(circumference * value) / 100} ${circumference}`}
        transform="rotate(-90 12 12)"
      />
    </Box>
  );
}
