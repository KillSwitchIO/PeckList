// The big checkbox at the top of task details. Completing pops the box, sweeps in the fill,
// draws the check and throws a small burst of dots; reopening just clears it.

import { keyframes } from '@emotion/react';
import { Box, ButtonBase, useTheme } from '@mui/material';
import { useState } from 'react';
import { setTaskStatus } from '../../core/tasks.ts';
import type { Task } from '../../core/types.ts';
import { useLongPress } from '../hooks/useLongPress.ts';
import { t } from '../i18n/i18n.ts';
import { useApply } from '../store/hooks.ts';

const PRIORITY_KEY = { 0: 'none', 1: 'low', 2: 'medium', 3: 'high' } as const;
const SIZE = 22;
const BURST = 8;

const pop = keyframes`
  0% { transform: scale(1); }
  30% { transform: scale(0.82); }
  65% { transform: scale(1.14); }
  100% { transform: scale(1); }
`;
const fill = keyframes`
  from { transform: scale(0); }
  to { transform: scale(1); }
`;
const draw = keyframes`
  from { stroke-dashoffset: 20; }
  to { stroke-dashoffset: 0; }
`;
const burst = keyframes`
  0% { transform: rotate(var(--angle)) translateY(0) scale(1); opacity: 1; }
  100% { transform: rotate(var(--angle)) translateY(-17px) scale(0.3); opacity: 0; }
`;

export function CompleteCheckbox({
  task,
  onMenu,
}: {
  task: Task;
  /** Right-click or long-press: open the task menu at this point. */
  onMenu: (position: { top: number; left: number }) => void;
}) {
  const theme = useTheme();
  const apply = useApply();
  // Animate only a completion made here, not a task that was already done.
  const [celebrating, setCelebrating] = useState(false);
  const longPress = useLongPress(onMenu);
  const done = task.status === 'done';
  const closed = task.status !== 'open';
  const ring =
    task.priority === 0
      ? theme.palette.text.secondary
      : theme.punchlist.priority[PRIORITY_KEY[task.priority]].fill;
  // Everything takes the priority's color: the box, the fill, the check's contrast and the
  // burst. No priority uses the accent.
  const tone = task.priority === 0 ? theme.palette.primary.main : ring;
  const onTone = theme.palette.getContrastText(tone);
  const title = task.title || t('task.untitled');

  return (
    <ButtonBase
      role="checkbox"
      aria-checked={closed}
      aria-label={closed ? t('task.reopen', { title }) : t('task.complete', { title })}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu({ top: event.clientY, left: event.clientX });
      }}
      {...longPress}
      onClick={() => {
        if (closed) {
          setCelebrating(false);
          apply((ctx, ws) => setTaskStatus(ctx, ws, task.id, 'open'), t('undo.reopened'));
        } else {
          setCelebrating(true);
          apply((ctx, ws) => setTaskStatus(ctx, ws, task.id, 'done'), t('undo.completed'));
        }
      }}
      sx={{
        position: 'relative',
        width: 36,
        height: 36,
        borderRadius: '50%',
        flexShrink: 0,
        '&:hover .box': { borderColor: closed ? undefined : tone },
        '@media (prefers-reduced-motion: reduce)': {
          '& *': { animation: 'none !important' },
        },
      }}
    >
      <Box
        className="box"
        sx={{
          position: 'relative',
          width: SIZE,
          height: SIZE,
          borderRadius: '6px',
          border: `2px solid ${closed ? (done ? tone : theme.palette.text.disabled) : ring}`,
          overflow: 'hidden',
          transition: 'border-color 150ms',
          animation: celebrating && done ? `${pop} 380ms ease-out` : 'none',
        }}
      >
        {closed && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              bgcolor: done ? tone : 'text.disabled',
              borderRadius: '3px',
              animation: celebrating && done ? `${fill} 220ms ease-out` : 'none',
            }}
          />
        )}
        {closed && (
          <Box
            component="svg"
            viewBox="0 0 24 24"
            sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          >
            {done ? (
              <path
                d="M6 12.5l4 4L18 8"
                fill="none"
                stroke={onTone}
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={20}
                style={{
                  animation: celebrating ? `${draw} 260ms 140ms ease-out both` : undefined,
                }}
              />
            ) : (
              // Won't do: an x.
              <path
                d="M8 8l8 8M16 8l-8 8"
                stroke={theme.palette.background.paper}
                strokeWidth={3}
                strokeLinecap="round"
              />
            )}
          </Box>
        )}
      </Box>
      {celebrating && done && (
        <Box aria-hidden sx={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {Array.from({ length: BURST }, (_, index) => (
            <Box
              key={index}
              onAnimationEnd={index === 0 ? () => setCelebrating(false) : undefined}
              style={{ ['--angle' as string]: `${(360 / BURST) * index}deg` }}
              sx={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                width: 5,
                height: 5,
                ml: '-2.5px',
                mt: '-2.5px',
                borderRadius: '50%',
                bgcolor: tone,
                animation: `${burst} 520ms 120ms ease-out both`,
              }}
            />
          ))}
        </Box>
      )}
    </ButtonBase>
  );
}
