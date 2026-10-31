import { useCallback, useEffect } from "react";
import { scopedKey } from "../lib/accountScope";
import { useOwnerStorage } from "../lib/useOwnerStorage";
import { WALLPAPER_STORAGE_KEY, type WallpaperId, parseWallpaper } from "../lib/wallpaper";

/**
 * The chosen wallpaper, remembered per device and per account like the theme.
 *
 * A wallpaper is the background of *these* conversations. On a shared browser the next person's
 * chats should start on their own background, not on the one the previous account picked.
 */
export function useWallpaper(accountId: string | null) {
  const { value: wallpaper, setValue: setWallpaperState, store } = useOwnerStorage<WallpaperId>({
    accountId,
    key: WALLPAPER_STORAGE_KEY,
    read: parseWallpaper,
    write: (value) => value,
  });

  const setWallpaper = useCallback(
    (next: WallpaperId) => {
      setWallpaperState(next);
    },
    [setWallpaperState]
  );

  // Another tab of the same account changing it should not leave this one behind.
  useEffect(() => {
    const fullKey = scopedKey(store.owner, WALLPAPER_STORAGE_KEY);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== fullKey) return;
      setWallpaperState(parseWallpaper(event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [store, setWallpaperState]);

  return { wallpaper, setWallpaper };
}
