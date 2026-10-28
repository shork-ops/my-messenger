/**
 * Client-side media preparation.
 *
 * Uploading a 12 MP phone photo as-is wastes the user's traffic and fills the
 * bucket, so images are downscaled and re-encoded before they leave the
 * browser. Everything here works on `Blob`s only, which keeps it testable
 * without a DOM beyond the canvas API the browser provides.
 */

/** Longest edge kept for images; enough for a full-width preview on any phone. */
export const MAX_IMAGE_EDGE = 1920;
/** JPEG/WebP quality for photos. */
export const IMAGE_QUALITY = 0.82;
/** Longest edge kept for gallery thumbnails. */
export const THUMB_EDGE = 320;
/** Files below this size are uploaded untouched: re-encoding only loses quality. */
export const COMPRESSION_THRESHOLD = 320 * 1024;
/** Hard upload limit, enforced before any processing starts. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Formats the browser can decode and we can re-encode. GIF is excluded: canvas drops animation. */
const COMPRESSIBLE = new Set(["image/jpeg", "image/png", "image/webp"]);

export const SUPPORTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "audio/webm",
  "audio/mpeg",
  "audio/ogg",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
];

export function isImage(type: string): boolean {
  return type.startsWith("image/");
}

export function isCompressibleImage(type: string): boolean {
  return COMPRESSIBLE.has(type);
}

export function isSupportedFile(type: string): boolean {
  return SUPPORTED_TYPES.includes(type);
}

/**
 * Final dimensions that fit inside `maxEdge` while keeping the aspect ratio.
 * Returns the input unchanged when it already fits, and never rounds to 0.
 */
export function fitDimensions(width: number, height: number, maxEdge: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 1, height: 1 };
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height) };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Decides whether preparing the file is worth it. */
export function shouldCompress(file: { type: string; size: number }): boolean {
  return isCompressibleImage(file.type) && file.size > COMPRESSION_THRESHOLD;
}

/** Human-readable size for upload progress and file cards. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 Б";
  const units = ["Б", "КБ", "МБ", "ГБ"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${index === 0 ? value : value.toFixed(value < 10 ? 1 : 0)} ${units[index]}`;
}

export type PreparedImage = {
  /** The file to upload: either the original or the re-encoded version. */
  blob: Blob;
  fileName: string;
  width: number;
  height: number;
  /** Small inline preview, kept in the message so the bubble paints instantly. */
  thumbnail: string;
  compressed: boolean;
  originalSize: number;
  finalSize: number;
};

async function loadBitmap(blob: Blob): Promise<{ width: number; height: number; draw: (canvas: HTMLCanvasElement) => boolean }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    return {
      width: bitmap.width,
      height: bitmap.height,
      draw: (canvas) => {
        canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close?.();
        return true;
      },
    };
  }
  // Fallback for browsers without createImageBitmap: an object URL and <img>.
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("image decode failed"));
      element.src = url;
    });
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      draw: (canvas) => {
        canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
        return true;
      },
    };
  } finally {
    // Revoked after the element has decoded, so drawing still works.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("canvas encoding failed"))),
      type,
      quality
    );
  });
}

/**
 * Downscales and re-encodes an image, and builds a thumbnail.
 *
 * Falls back to the original file when anything goes wrong: a failed
 * optimisation must never block sending a message.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const fallback: PreparedImage = {
    blob: file,
    fileName: file.name,
    width: 0,
    height: 0,
    thumbnail: "",
    compressed: false,
    originalSize: file.size,
    finalSize: file.size,
  };
  if (!isCompressibleImage(file.type) || typeof document === "undefined") return fallback;

  try {
    const source = await loadBitmap(file);
    const target = fitDimensions(source.width, source.height, MAX_IMAGE_EDGE);

    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    source.draw(canvas);

    // Keep PNGs lossless only when they are small; JPEG is the safe default
    // for photos because transparency is rare and size matters more.
    const outputType = file.type === "image/png" && file.size < COMPRESSION_THRESHOLD ? "image/png" : "image/jpeg";
    let blob = await canvasToBlob(canvas, outputType, IMAGE_QUALITY);
    if (blob.size >= file.size) {
      // Re-encoding made it bigger (already optimised file): keep the original.
      blob = file;
    }

    const thumbCanvas = document.createElement("canvas");
    const thumb = fitDimensions(source.width, source.height, THUMB_EDGE);
    thumbCanvas.width = thumb.width;
    thumbCanvas.height = thumb.height;
    const thumbContext = thumbCanvas.getContext("2d");
    thumbContext?.drawImage(canvas, 0, 0, thumb.width, thumb.height);
    const thumbBlob = await canvasToBlob(thumbCanvas, "image/jpeg", 0.6);
    const thumbnail = await blobToDataUrl(thumbBlob);

    const extension = outputType === "image/png" ? "png" : "jpg";
    const baseName = file.name.replace(/\.[^.]+$/, "");
    return {
      blob,
      fileName: blob === file ? file.name : `${baseName}.${extension}`,
      width: target.width,
      height: target.height,
      thumbnail,
      compressed: blob !== file,
      originalSize: file.size,
      finalSize: blob.size,
    };
  } catch {
    return fallback;
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

/** Storage path: one folder per chat and sender, unique file name. */
export function buildStoragePath(chatId: string, userId: string, fileName: string, id: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  return `${chatId}/${userId}/${id}-${safe}`;
}
