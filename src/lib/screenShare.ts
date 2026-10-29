/**
 * Showing your screen in a call.
 *
 * The browser will not hand over a screen without a person choosing what to share, so
 * everything here is about what to ask for and how to explain what was granted — a
 * tab shown as if it were the whole screen is a misunderstanding worth avoiding.
 */

export type ScreenShareQuality = "text" | "motion";

export type ScreenShareRequest = {
  video: {
    displaySurface: "monitor" | "window" | "browser";
    frameRate: { ideal: number; max: number };
    width: { ideal: number };
    height: { ideal: number };
  };
  audio: false;
};

const QUALITY: Record<ScreenShareQuality, { frameRate: number; width: number; height: number }> = {
  // Text on a shared slide deck stays sharp at a low frame rate; a video benefits
  // from the opposite. Choosing one of the two is what the feature asks of a person.
  text: { frameRate: 5, width: 1920, height: 1080 },
  motion: { frameRate: 30, width: 1280, height: 720 },
};

export const DEFAULT_SCREEN_QUALITY: ScreenShareQuality = "text";

export function screenShareRequest(quality: ScreenShareQuality = DEFAULT_SCREEN_QUALITY): ScreenShareRequest {
  const settings = QUALITY[quality];
  return {
    video: {
      displaySurface: "monitor",
      frameRate: { ideal: settings.frameRate, max: settings.frameRate * 2 },
      width: { ideal: settings.width },
      height: { ideal: settings.height },
    },
    // System audio from a shared screen is a separate permission on several platforms
    // and arrives silent on others; offering it and getting nothing is worse than not
    // offering it.
    audio: false,
  };
}

/** Whether the browser can share a screen at all. */
export function canShareScreen(source: { mediaDevices?: { getDisplayMedia?: unknown } } = navigator): boolean {
  return typeof source.mediaDevices?.getDisplayMedia === "function";
}

/** What is being shared, in the words a person would use. */
export function describeSurface(surface: MediaStreamTrack["getSettings"] extends never ? never : string | undefined): string {
  switch (surface) {
    case "monitor":
      return "Весь экран";
    case "window":
      return "Окно";
    case "browser":
      return "Вкладка";
    default:
      return "Экран";
  }
}

/**
 * Why a share failed, in words that say what to do next.
 *
 * "Permission denied" tells nobody anything; the three cases below are what actually
 * happens when a person clicks the wrong button in the picker.
 */
export function shareErrorMessage(name: string): string {
  if (name === "NotAllowedError") return "Доступ к экрану не выдан";
  if (name === "NotSupportedError" || name === "TypeError") return "Браузер не умеет показывать экран";
  if (name === "AbortError") return "Выбор экрана отменён";
  return "Не удалось начать показ экрана";
}

/**
 * Whether the shared stream has ended on its own.
 *
 * Browsers end a share when the shared window closes or when the person presses the
 * browser's own "stop sharing" bar, and the call has to notice both.
 */
export function shareEnded(track: { readyState: string }): boolean {
  return track.readyState === "ended";
}
