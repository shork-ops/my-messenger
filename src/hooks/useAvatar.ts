import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { AVATAR_EDGE, avatarRejectionMessage, buildAvatarPath, checkAvatarFile, isAvatarPath } from "../lib/avatar";
import { blobToDataUrl, fitDimensions } from "../lib/media";

/** How long a resolved avatar URL stays trusted before it is refreshed. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * Turns an avatar the user picked into a small, re-encoded square image.
 *
 * Falls back to the original blob when the canvas path fails, so a browser quirk
 * cannot block setting a picture at all.
 */
export async function prepareAvatar(file: File): Promise<{ blob: Blob; type: string }> {
  const fallback = { blob: file as Blob, type: file.type };
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return fallback;
  try {
    const bitmap = await createImageBitmap(file);
    const size = fitDimensions(bitmap.width, bitmap.height, AVATAR_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
    if (!blob || blob.size >= file.size) return fallback;
    return { blob, type: "image/jpeg" };
  } catch {
    return fallback;
  }
}

type UseAvatarOptions = {
  userId: string | null;
  /** Stored path from the profile row, or a legacy letter that is not a path. */
  storedPath: string | null;
  notify: (message: string) => void;
};

export function useAvatar({ userId, storedPath, notify }: UseAvatarOptions) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const lastSigned = useRef<{ path: string; url: string; at: number } | null>(null);

  // Sign the stored path. Done here rather than in the database because a signed
  // URL expires and must never be persisted.
  useEffect(() => {
    let alive = true;
    const client = supabase;
    if (!client || !isAvatarPath(storedPath)) {
      setAvatarUrl(null);
      return;
    }
    const path = storedPath as string;
    const cached = lastSigned.current;
    if (cached && cached.path === path && Date.now() - cached.at < SIGNED_URL_TTL_SECONDS * 1000 * 0.9) {
      setAvatarUrl(cached.url);
      return;
    }
    const sign = async () => {
      const { data, error } = await client.storage.from("avatars").createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
      if (!alive) return;
      if (error || !data?.signedUrl) {
        // A missing file must not break the screen: fall back to the letter.
        setAvatarUrl(null);
        return;
      }
      lastSigned.current = { path, url: data.signedUrl, at: Date.now() };
      setAvatarUrl(data.signedUrl);
    };
    void sign();
    return () => {
      alive = false;
    };
  }, [storedPath]);

  const upload = useCallback(
    async (file: File): Promise<string | null> => {
      const client = supabase;
      if (!client || !userId) {
        notify("Загрузка фото доступна только после входа");
        return null;
      }
      const rejection = avatarRejectionMessage(checkAvatarFile(file));
      if (rejection) {
        notify(rejection);
        return null;
      }
      setUploading(true);
      setLocalPreview(await blobToDataUrl(file).catch(() => null));
      try {
        const prepared = await prepareAvatar(file);
        const id = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
        const path = buildAvatarPath(userId, id, prepared.type);

        const uploaded = await client.storage.from("avatars").upload(path, prepared.blob, {
          contentType: prepared.type,
          upsert: true,
        });
        if (uploaded.error) {
          notify("Не удалось загрузить фото. Попробуй ещё раз.");
          return null;
        }

        const previous = isAvatarPath(storedPath) ? (storedPath as string) : null;
        const saved = await client.from("profiles").update({ avatar_path: path, updated_at: new Date().toISOString() }).eq("id", userId);
        if (saved.error) {
          // The row is the source of truth; an orphaned file is harmless.
          notify("Фото загружено, но не сохранилось в профиле");
          return null;
        }

        // Remove the previous file only after the new one is recorded.
        if (previous && previous !== path) {
          await client.storage.from("avatars").remove([previous]);
        }

        const signed = await client.storage.from("avatars").createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
        if (signed.data?.signedUrl) {
          lastSigned.current = { path, url: signed.data.signedUrl, at: Date.now() };
          setAvatarUrl(signed.data.signedUrl);
        }
        notify("Фото профиля обновлено");
        return path;
      } finally {
        setUploading(false);
        setLocalPreview(null);
      }
    },
    [userId, storedPath, notify]
  );

  const remove = useCallback(async () => {
    const client = supabase;
    if (!client || !userId) return;
    setUploading(true);
    try {
      const previous = isAvatarPath(storedPath) ? (storedPath as string) : null;
      const cleared = await client.from("profiles").update({ avatar_path: null, updated_at: new Date().toISOString() }).eq("id", userId);
      if (cleared.error) {
        notify("Не удалось убрать фото");
        return;
      }
      if (previous) await client.storage.from("avatars").remove([previous]);
      lastSigned.current = null;
      setAvatarUrl(null);
      notify("Фото профиля убрано");
    } finally {
      setUploading(false);
    }
  }, [userId, storedPath, notify]);

  return { avatarUrl, uploading, localPreview, upload, remove };
}
