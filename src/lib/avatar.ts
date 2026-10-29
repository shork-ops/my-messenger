/**
 * Avatar rules shared by the settings screen and the profile card.
 *
 * The bucket is private, so what the database stores is a path, never a URL: a
 * signed URL stops working after an hour and would have to be refreshed
 * everywhere it was copied to. Turning the path into a URL is a render-time job.
 */

/** Longest edge for a stored avatar. Large enough for a 128px circle on a 3x phone. */
export const AVATAR_EDGE = 512;
/** Hard limit, matching the bucket configuration. */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
/** Formats the bucket accepts. */
export const AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type AvatarRejection = "too-large" | "wrong-type" | null;

/**
 * Whether a file may be uploaded as an avatar.
 *
 * Returns a reason rather than a boolean so the screen can say what is wrong
 * instead of a generic failure.
 */
export function checkAvatarFile(file: { type: string; size: number }): AvatarRejection {
  if (!AVATAR_TYPES.includes(file.type as (typeof AVATAR_TYPES)[number])) return "wrong-type";
  if (file.size > AVATAR_MAX_BYTES) return "too-large";
  return null;
}

/** Message for a rejected file, or null when the file is fine. */
export function avatarRejectionMessage(reason: AvatarRejection): string | null {
  if (reason === "too-large") return "Фото больше 5 МБ. Выбери файл поменьше.";
  if (reason === "wrong-type") return "Подойдёт JPEG, PNG или WebP.";
  return null;
}

/** Storage path for a user's avatar: "{userId}/{stamp}.{ext}". */
export function buildAvatarPath(userId: string, id: string, type: string): string {
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  return `${userId}/${id}.${ext}`;
}

/**
 * First path segment of an avatar path, which is the owner's id. Used by the
 * cleanup step to make sure it never deletes a file from another folder.
 */
export function avatarOwner(path: string): string | null {
  const first = path.split("/")[0];
  return first ? first : null;
}

/** True when the stored value looks like a real avatar path rather than a legacy letter. */
export function isAvatarPath(value: string | null | undefined): boolean {
  if (!value) return false;
  // Legacy avatars are a single letter or emoji, and contain no slash.
  return value.includes("/") && value.length > 3;
}

/** Two-letter fallback used when the photo is missing or hidden. */
export function avatarFallback(name: string): string {
  const trimmed = (name || "").trim();
  if (!trimmed) return "?";
  // Emoji already carries a full character; slicing by code point avoids a broken surrogate.
  return Array.from(trimmed)[0].toUpperCase();
}
