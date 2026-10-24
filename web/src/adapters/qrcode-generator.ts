import qrcode from 'qrcode-generator';
import type { QrEncoder } from '../ports/qr.ts';

/** The QrEncoder port on qrcode-generator: smallest version that fits, medium error correction. */
export const encodeQr: QrEncoder = (text) => {
  const code = qrcode(0, 'M');
  code.addData(text, 'Byte');
  code.make();
  const size = code.getModuleCount();
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => code.isDark(row, col)),
  );
};
