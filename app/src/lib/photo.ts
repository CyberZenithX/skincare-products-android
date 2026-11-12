// Photo preparation: one un-mirrored ~1024px JPEG that is used for EVERYTHING
// (contours, brightness, upload, display), so the Skin Map lines up with what
// Gemini saw, pixel for pixel.

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { Skia, AlphaType, ColorType } from '@shopify/react-native-skia';
import type { ScanPhoto } from './scanStore';

const LONG_SIDE = 1024;

export interface PreparedPhoto extends ScanPhoto {
  /** Temporary file of the prepared JPEG, used once for contour detection, then deleted. */
  tempUri: string;
}

/**
 * @param mirrored true when the capture was saved mirrored (front camera preview style).
 *   We flip it back so left/right are the person's real sides everywhere.
 */
export async function preparePhoto(uri: string, mirrored: boolean, source: ScanPhoto['source']): Promise<PreparedPhoto> {
  // First pass applies EXIF orientation, so width/height are the upright size.
  const upright = await ImageManipulator.manipulate(uri).renderAsync();
  const ctx = ImageManipulator.manipulate(upright);
  if (mirrored) ctx.flip('horizontal');
  if (Math.max(upright.width, upright.height) > LONG_SIDE)
    ctx.resize(upright.width >= upright.height ? { width: LONG_SIDE } : { height: LONG_SIDE });
  const ref = await ctx.renderAsync();
  const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
  if (!out.base64) throw new Error('no base64');
  return { base64: out.base64, width: out.width, height: out.height, source, tempUri: out.uri };
}

export function deleteQuietly(...uris: (string | null | undefined)[]) {
  for (const u of uris) {
    if (!u) continue;
    try {
      const f = new File(u);
      if (f.exists) f.delete();
    } catch {
      /* already gone */
    }
  }
}

export type Exposure = 'ok' | 'too_dark' | 'too_bright';

/**
 * Average brightness of the centre of the photo (where the face is), from a
 * 32×32 downscale. Thresholds are deliberately loose: Gemini makes the final
 * call; this only catches photos that are clearly unusable.
 */
export function checkExposure(base64: string): { exposure: Exposure; luma: number } {
  const img = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(base64));
  if (!img) return { exposure: 'ok', luma: -1 };
  const N = 32;
  const surface = Skia.Surface.MakeOffscreen(N, N) ?? Skia.Surface.Make(N, N);
  if (!surface) return { exposure: 'ok', luma: -1 };
  const canvas = surface.getCanvas();
  // Centre 60% of the frame.
  const sw = img.width() * 0.6;
  const sh = img.height() * 0.6;
  canvas.drawImageRect(
    img,
    Skia.XYWHRect((img.width() - sw) / 2, (img.height() - sh) / 2, sw, sh),
    Skia.XYWHRect(0, 0, N, N),
    Skia.Paint(),
  );
  surface.flush();
  const px = surface
    .makeImageSnapshot()
    .readPixels(0, 0, { width: N, height: N, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
  if (!px) return { exposure: 'ok', luma: -1 };
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += 0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!;
  const luma = sum / (px.length / 4);
  return { exposure: luma < 55 ? 'too_dark' : luma > 235 ? 'too_bright' : 'ok', luma };
}
