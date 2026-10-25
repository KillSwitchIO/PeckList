import { PHOTO_MAX_LENGTH } from '../../core/profile.ts';

/** The saved picture's size, as the photo editor saves one. */
const OUT = 192;

/** A picture as a small square JPEG, its middle cut to fit (null where the browser cannot draw it). */
export async function squarePhoto(blob: Blob): Promise<string | null> {
  if (typeof createImageBitmap !== 'function') return null;
  const image = await createImageBitmap(blob);
  const side = Math.min(image.width, image.height);
  const canvas = document.createElement('canvas');
  canvas.width = OUT;
  canvas.height = OUT;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 0, OUT, OUT);
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    image,
    (image.width - side) / 2,
    (image.height - side) / 2,
    side,
    side,
    0,
    0,
    OUT,
    OUT,
  );
  image.close();
  for (const quality of [0.86, 0.72, 0.55]) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.length <= PHOTO_MAX_LENGTH) return url;
  }
  return null;
}
