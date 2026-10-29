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
