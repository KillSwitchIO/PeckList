import ZoomInRounded from '@mui/icons-material/ZoomInRounded';
import ZoomOutRounded from '@mui/icons-material/ZoomOutRounded';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Slider,
} from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { PHOTO_MAX_LENGTH, setProfilePhoto } from '../../core/profile.ts';
import { t } from '../i18n/i18n.ts';
import { useApply } from '../store/hooks.ts';
import { Avatar } from './Avatar.tsx';
import {
  clampPlacement,
  cropSquare,
  scaleRange,
  startPlacement,
  zoomAbout,
  type Placement,
} from './photoCrop.ts';

/** The working square, and the circle in it. */
const STAGE = 256;
const CIRCLE = 220;
/** The saved picture, square, in pixels: sharp at the sizes it shows (40 px on a 3x screen). */
const OUT = 192;

/** The picked image, drawn once loaded. */
interface Picked {
  url: string;
  image: HTMLImageElement;
  width: number;
  height: number;
}

/** The circle's part of the image as a small JPEG, smaller still if it comes out too big. */
function render(picked: Picked, placement: Placement): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = OUT;
  canvas.height = OUT;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const square = cropSquare(placement, picked.width, picked.height, CIRCLE);
  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 0, OUT, OUT);
  context.imageSmoothingQuality = 'high';
  context.drawImage(picked.image, square.x, square.y, square.size, square.size, 0, 0, OUT, OUT);
  for (const quality of [0.86, 0.72, 0.55, 0.4]) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.length <= PHOTO_MAX_LENGTH) return url;
  }
  return null;
}

/**
 * The profile photo (spec: R-FB-57): pick a picture, then drag it (one finger or the mouse) and
 * zoom it (two fingers, the wheel, or the slider) until the face sits in the circle. Saved as a
 * small square on the person's profile, so friends see it too.
 */
export function PhotoDialog({
  name,
  color,
  photo,
  onClose,
}: {
  name: string;
  color: string;
  photo: string | undefined;
  onClose: () => void;
}) {
  const apply = useApply();
  const input = useRef<HTMLInputElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [placement, setPlacement] = useState<Placement>({ scale: 1, x: 0, y: 0 });
  const [problem, setProblem] = useState<string | null>(null);
  const latest = useRef({ picked, placement });
  useEffect(() => {
    latest.current = { picked, placement };
  });
  // Let go of the picked file's memory when done with it.
  useEffect(() => () => (picked ? URL.revokeObjectURL(picked.url) : undefined), [picked]);

  const choose = (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      setPicked({ url, image, width, height });
      setPlacement(startPlacement(width, height, CIRCLE));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setProblem(t('photo.unreadable'));
    };
    image.src = url;
  };

  const place = (next: Placement) => {
    const now = latest.current.picked;
    if (now) setPlacement(clampPlacement(next, now.width, now.height, CIRCLE));
  };
  /** A point on screen as an offset from the circle's middle. */
  const fromMiddle = (clientX: number, clientY: number) => {
    const box = stage.current!.getBoundingClientRect();
    return { x: clientX - box.left - box.width / 2, y: clientY - box.top - box.height / 2 };
  };
  const zoomTo = (scale: number, at = { x: 0, y: 0 }) => {
    const now = latest.current;
    if (!now.picked) return;
    setPlacement(
      zoomAbout(now.placement, scale, at.x, at.y, now.picked.width, now.picked.height, CIRCLE),
    );
  };

  // Fingers and the mouse: one drags, two pinch (and drag by their middle).
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const press = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!picked) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
  };
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const known = pointers.current;
    const before = known.get(event.pointerId);
    if (!before) return;
    const now = latest.current.placement;
    if (known.size === 1) {
      place({ ...now, x: now.x + event.clientX - before.x, y: now.y + event.clientY - before.y });
    } else {
      // Two fingers: the image follows their middle and grows or shrinks with their spread.
      const other = [...known.entries()].find(([id]) => id !== event.pointerId)?.[1];
      const current = latest.current.picked;
      if (other && current) {
        const spreadBefore = Math.hypot(other.x - before.x, other.y - before.y) || 1;
        const spreadNow = Math.hypot(other.x - event.clientX, other.y - event.clientY) || 1;
        const middleBefore = { x: (other.x + before.x) / 2, y: (other.y + before.y) / 2 };
        const middleNow = { x: (other.x + event.clientX) / 2, y: (other.y + event.clientY) / 2 };
        const panned = clampPlacement(
          {
            ...now,
            x: now.x + middleNow.x - middleBefore.x,
            y: now.y + middleNow.y - middleBefore.y,
          },
          current.width,
          current.height,
          CIRCLE,
        );
        const at = fromMiddle(middleNow.x, middleNow.y);
        setPlacement(
          zoomAbout(
            panned,
            now.scale * (spreadNow / spreadBefore),
            at.x,
            at.y,
            current.width,
            current.height,
            CIRCLE,
          ),
        );
      }
    }
    known.set(event.pointerId, { x: event.clientX, y: event.clientY });
  };
  const lift = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
  };

  // The wheel zooms about the pointer (and keeps the page from scrolling under the dialog).
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!latest.current.picked) return;
      event.preventDefault();
      const at = fromMiddle(event.clientX, event.clientY);
      zoomTo(latest.current.placement.scale * Math.exp(-event.deltaY * 0.002), at);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  });

  const range = picked ? scaleRange(picked.width, picked.height, CIRCLE) : { least: 1, most: 6 };
  // The slider runs on the zoom as a multiple of the least: 1x to 6x.
  const zoom = placement.scale / range.least;

  const save = () => {
    if (!picked) return;
    const url = render(picked, placement);
    if (!url) {
      setProblem(t('photo.unreadable'));
      return;
    }
    apply((ctx, ws) => setProfilePhoto(ctx, ws, url));
    onClose();
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('photo.title')}</DialogTitle>
      <DialogContent sx={{ display: 'grid', justifyItems: 'center', gap: 2, px: 2 }}>
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          aria-label={t('photo.choose')}
          onChange={(event) => {
            choose(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        {picked ? (
          <>
            <Box
              ref={stage}
              role="img"
              tabIndex={0}
              aria-label={t('photo.stage')}
              onPointerDown={press}
              onPointerMove={move}
              onPointerUp={lift}
              onPointerCancel={lift}
              onKeyDown={(event) => {
                const step = event.shiftKey ? 20 : 5;
                const by: Record<string, [number, number]> = {
                  ArrowLeft: [-step, 0],
                  ArrowRight: [step, 0],
                  ArrowUp: [0, -step],
                  ArrowDown: [0, step],
                };
                const delta = by[event.key];
                if (delta) {
                  event.preventDefault();
                  place({ ...placement, x: placement.x + delta[0], y: placement.y + delta[1] });
                } else if (event.key === '+' || event.key === '=') {
                  zoomTo(placement.scale * 1.1);
                } else if (event.key === '-') {
                  zoomTo(placement.scale / 1.1);
                }
              }}
              sx={{
                position: 'relative',
                width: STAGE,
                height: STAGE,
                flexShrink: 0,
                overflow: 'hidden',
                borderRadius: 2,
                bgcolor: 'common.black',
                touchAction: 'none',
                cursor: 'grab',
                userSelect: 'none',
                '&:active': { cursor: 'grabbing' },
                '&:focus-visible': { outline: 2, outlineColor: 'primary.main', outlineOffset: 2 },
              }}
            >
              <Box
                component="img"
                src={picked.url}
                alt=""
                draggable={false}
                sx={{
                  position: 'absolute',
                  maxWidth: 'none',
                  pointerEvents: 'none',
                }}
                style={{
                  width: picked.width * placement.scale,
                  height: picked.height * placement.scale,
                  left: STAGE / 2 + placement.x - (picked.width * placement.scale) / 2,
                  top: STAGE / 2 + placement.y - (picked.height * placement.scale) / 2,
                }}
              />
              {/* Everything outside the circle dims. */}
              <Box
                aria-hidden
                sx={{
                  position: 'absolute',
                  left: (STAGE - CIRCLE) / 2,
                  top: (STAGE - CIRCLE) / 2,
                  width: CIRCLE,
                  height: CIRCLE,
                  borderRadius: '50%',
                  boxShadow: '0 0 0 400px rgba(0, 0, 0, 0.55)',
                  border: '2px solid rgba(255, 255, 255, 0.9)',
                  pointerEvents: 'none',
                }}
              />
            </Box>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                width: STAGE,
                maxWidth: '100%',
              }}
            >
              <ZoomOutRounded fontSize="small" color="action" />
              <Slider
                size="small"
                min={1}
                max={6}
                step={0.01}
                value={zoom}
                onChange={(_, value) => zoomTo(value * range.least)}
                slotProps={{ input: { 'aria-label': t('photo.zoom') } }}
              />
              <ZoomInRounded fontSize="small" color="action" />
            </Box>
            <Box sx={{ typography: 'caption', color: 'text.secondary', textAlign: 'center' }}>
              {t('photo.hint')}
            </Box>
          </>
        ) : (
          <>
            <Avatar name={name} color={color} photo={photo} size={120} />
            <Button variant="outlined" onClick={() => input.current?.click()}>
              {photo ? t('photo.change') : t('photo.choose')}
            </Button>
          </>
        )}
        {problem && (
          <Alert severity="error" variant="outlined" sx={{ width: '100%' }}>
            {problem}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        {!picked && photo && (
          <Button
            color="error"
            onClick={() => {
              apply((ctx, ws) => setProfilePhoto(ctx, ws, ''), t('undo.photoRemoved'));
              onClose();
            }}
            sx={{ mr: 'auto' }}
          >
            {t('photo.remove')}
          </Button>
        )}
        {picked && (
          <Button onClick={() => input.current?.click()} sx={{ mr: 'auto' }}>
            {t('photo.another')}
          </Button>
        )}
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        {picked && (
          <Button variant="contained" disableElevation onClick={save}>
            {t('photo.save')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
