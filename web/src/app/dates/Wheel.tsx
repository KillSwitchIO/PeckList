import { Box, useTheme } from '@mui/material';
import { useEffect, useLayoutEffect, useRef } from 'react';

export const WHEEL_ITEM = 40;
const VISIBLE = 5;

/**
 * One scrolling wheel (iOS-style): swipe to spin, the centered item is the value. Uses CSS
 * scroll snapping, so it works with touch, mouse wheel and trackpads. Tap an item to jump to
 * it; arrow keys step when focused.
 */
export function Wheel<T extends string | number>({
  label,
  options,
  value,
  format = (option) => String(option),
  onChange,
  width = 64,
}: {
  label: string;
  options: readonly T[];
  value: T;
  format?: (option: T) => string;
  onChange: (value: T) => void;
  width?: number;
}) {
  const theme = useTheme();
  const scroller = useRef<HTMLDivElement>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const index = Math.max(0, options.indexOf(value));

  // Keep the scroll position on the current value (initially and after outside changes).
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && Math.round(element.scrollTop / WHEEL_ITEM) !== index) {
      element.scrollTop = index * WHEEL_ITEM;
    }
  }, [index]);

  useEffect(
    () => () => {
      if (settle.current) clearTimeout(settle.current);
    },
    [],
  );

  const pick = (next: number) => {
    const clamped = Math.min(options.length - 1, Math.max(0, next));
    scroller.current?.scrollTo?.({ top: clamped * WHEEL_ITEM, behavior: 'smooth' });
    if (clamped !== index) onChange(options[clamped]!);
  };

  const onScroll = () => {
    if (settle.current) clearTimeout(settle.current);
    // Read the value once the wheel stops moving.
    settle.current = setTimeout(() => {
      const element = scroller.current;
      if (!element) return;
      const next = Math.min(
        options.length - 1,
        Math.max(0, Math.round(element.scrollTop / WHEEL_ITEM)),
      );
      if (next !== index) onChange(options[next]!);
    }, 120);
  };

  return (
    <Box sx={{ position: 'relative', width, height: WHEEL_ITEM * VISIBLE }}>
      {/* selection band behind the centered row */}
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: WHEEL_ITEM * 2,
          height: WHEEL_ITEM,
          borderRadius: 2,
          bgcolor: 'action.selected',
          pointerEvents: 'none',
        }}
      />
      <Box
        ref={scroller}
        role="listbox"
        aria-label={label}
        tabIndex={0}
        onScroll={onScroll}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            pick(index + 1);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            pick(index - 1);
          }
        }}
        sx={{
          position: 'relative',
          height: '100%',
          overflowY: 'auto',
          scrollSnapType: 'y mandatory',
          overscrollBehavior: 'contain',
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
          maskImage: 'linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)',
          py: `${WHEEL_ITEM * 2}px`,
          outline: 'none',
          '&:focus-visible': {
            boxShadow: `inset 0 0 0 2px ${theme.palette.primary.main}`,
            borderRadius: 2,
          },
        }}
      >
        {options.map((option, i) => (
          <Box
            key={String(option)}
            role="option"
            aria-selected={i === index}
            onClick={() => pick(i)}
            sx={{
              height: WHEEL_ITEM,
              display: 'grid',
              placeItems: 'center',
              scrollSnapAlign: 'center',
              cursor: 'pointer',
              userSelect: 'none',
              typography: 'h2',
              fontWeight: i === index ? 600 : 400,
              color: i === index ? 'text.primary' : 'text.secondary',
            }}
          >
            {format(option)}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
