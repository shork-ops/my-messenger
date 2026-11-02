import { useCallback, useEffect, useState } from "react";
import { WALLPAPER_STORAGE_KEY, type WallpaperId, parseWallpaper } from "../lib/wallpaper";

/** The chosen wallpaper, remembered per device like the theme. */
export function useWallpaper() {
  const [wallpaper, setWallpaperState] = useState<WallpaperId>(() => {
    if (typeof window === "undefined") return parseWallpaper(null);
    try {
      return parseWallpaper(window.localStorage.getItem(WALLPAPER_STORAGE_KEY));
    } catch {
      return parseWallpaper(null);
    }
  });

  const setWallpaper = useCallback((next: WallpaperId) => {
    setWallpaperState(next);
    try {
      window.localStorage.setItem(WALLPAPER_STORAGE_KEY, next);
    } catch {
      // Storage blocked: the choice holds for this session.
    }
  }, []);

  // Another tab changing it should not leave this one behind.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== WALLPAPER_STORAGE_KEY) return;
      setWallpaperState(parseWallpaper(event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return { wallpaper, setWallpaper };
}

/** Where the person's own wallpaper photo is kept: on this device only, like the theme. */
export const WALLPAPER_PHOTO_KEY = "nexus-wallpaper-photo";
const PHOTO_EVENT = "nexus-wallpaper-photo";

function readPhoto(): string | null {
  try {
    return window.localStorage.getItem(WALLPAPER_PHOTO_KEY);
  } catch {
    return null;
  }
}

/**
 * Stores or removes the wallpaper photo. False when the browser refused it, which happens
 * when storage is full or blocked; the caller says so instead of pretending it worked.
 */
export function saveWallpaperPhoto(dataUrl: string | null): boolean {
  try {
    if (dataUrl) window.localStorage.setItem(WALLPAPER_PHOTO_KEY, dataUrl);
    else window.localStorage.removeItem(WALLPAPER_PHOTO_KEY);
  } catch {
    return false;
  }
  window.dispatchEvent(new Event(PHOTO_EVENT));
  return true;
}

/** The wallpaper photo, kept in step with settings and with other tabs. */
export function useWallpaperPhoto(): string | null {
  const [photo, setPhoto] = useState<string | null>(readPhoto);
  useEffect(() => {
    const refresh = () => setPhoto(readPhoto());
    const onStorage = (event: StorageEvent) => {
      if (event.key === WALLPAPER_PHOTO_KEY) refresh();
    };
    window.addEventListener(PHOTO_EVENT, refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(PHOTO_EVENT, refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return photo;
}
