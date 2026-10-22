/**
 * Turns text into a QR code's modules: `true` is a dark square. Rows top to bottom, no quiet
 * zone (the drawing adds it). Swap the library behind it by adding an adapter that passes
 * `adapters/qr.test.ts`.
 */
export type QrEncoder = (text: string) => boolean[][];
