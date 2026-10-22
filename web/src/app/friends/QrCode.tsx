import { Box } from '@mui/material';
import { encodeQr } from '../../adapters/qrcode-generator.ts';

const QUIET = 4;

/** A QR code as an SVG: dark on white with its quiet zone, whatever the theme (scanners need it). */
export function QrCode({
  text,
  size = 220,
  label,
}: {
  text: string;
  size?: number;
  label: string;
}) {
  const modules = encodeQr(text);
  const span = modules.length + QUIET * 2;
  // One path of 1x1 squares keeps the DOM small.
  const path = modules
    .flatMap((row, y) => row.map((dark, x) => (dark ? `M${x + QUIET} ${y + QUIET}h1v1h-1z` : '')))
    .join('');
  return (
    <Box
      component="svg"
      role="img"
      aria-label={label}
      viewBox={`0 0 ${span} ${span}`}
      shapeRendering="crispEdges"
      sx={{ width: size, height: size, bgcolor: '#FFFFFF', borderRadius: 2, display: 'block' }}
    >
      <path d={path} fill="#000000" />
    </Box>
  );
}
