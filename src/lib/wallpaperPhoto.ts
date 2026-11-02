/**
 * Turning a photo from the device into a wallpaper.
 *
 * A phone photo is 3-12 MB; kept as it is, it would not fit in browser storage and would make
 * every conversation slow to paint. It is scaled down to what a screen can show and saved as
 * JPEG. Used by settings only, so it loads with them and not with the first screen.
 */

/** Longest side of the stored picture: sharp on a phone held upright and on a laptop. */
export const WALLPAPER_MAX_SIDE = 1600;

/** Above this the photo is saved again, smaller, so it still fits next to everything else. */
export const WALLPAPER_MAX_CHARS = 1_400_000;

/** The size a picture is drawn at so its longest side is at most `max`; never enlarged. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function decode(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A data URL for the wallpaper, or null when the file is not a picture the browser can read. */
export async function prepareWallpaperPhoto(file: File): Promise<string | null> {
  if (!file.type.startsWith("image/")) return null;
  let image: HTMLImageElement;
  try {
    image = await decode(file);
  } catch {
    return null;
  }
  for (const [side, quality] of [
    [WALLPAPER_MAX_SIDE, 0.82],
    [1200, 0.72],
    [900, 0.65],
  ] as const) {
    const size = fitWithin(image.naturalWidth, image.naturalHeight, side);
    if (size.width === 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, 0, 0, size.width, size.height);
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (dataUrl.length <= WALLPAPER_MAX_CHARS) return dataUrl;
  }
  return null;
}
