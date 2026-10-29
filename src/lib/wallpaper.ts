/**
 * Chat wallpaper.
 *
 * Patterns are drawn in CSS rather than shipped as images: a bundled photograph
 * costs more than every other asset combined, and a pattern that follows the
 * theme's colours cannot clash with it in the light theme.
 */

export const WALLPAPERS = [
  { id: "none", label: "Без обоев", hint: "Фон темы" },
  { id: "dots", label: "Точки", hint: "Редкая сетка" },
  { id: "grid", label: "Сетка", hint: "Клетка" },
  { id: "diagonal", label: "Диагональ", hint: "Наклонные полосы" },
  { id: "waves", label: "Волны", hint: "Плавные линии" },
] as const;

export type WallpaperId = (typeof WALLPAPERS)[number]["id"];

export const DEFAULT_WALLPAPER: WallpaperId = "none";

export const WALLPAPER_STORAGE_KEY = "nexus-wallpaper";

export function parseWallpaper(raw: string | null | undefined): WallpaperId {
  const found = WALLPAPERS.find((item) => item.id === raw);
  return found ? found.id : DEFAULT_WALLPAPER;
}

/**
 * The CSS that draws a wallpaper.
 *
 * Opacity is deliberately low: a background pattern competes with text for
 * attention, and at full strength a grid makes message bubbles hard to read. Returned
 * as a value rather than a class so the light theme can scale it down further
 * without a second stylesheet.
 */
export function wallpaperBackground(id: WallpaperId, accent: string): string {
  switch (id) {
    case "dots":
      return `radial-gradient(${accent} 1px, transparent 1px)`;
    case "grid":
      return `linear-gradient(${accent} 1px, transparent 1px), linear-gradient(90deg, ${accent} 1px, transparent 1px)`;
    case "diagonal":
      return `repeating-linear-gradient(45deg, ${accent} 0 1px, transparent 1px 16px)`;
    case "waves":
      return `repeating-radial-gradient(circle at 50% 0, transparent 0 22px, ${accent} 22px 23px)`;
    case "none":
    default:
      return "none";
  }
}

/**
 * The tile size for a wallpaper.
 *
 * A background position and size cannot ride along with the image: folding them
 * into `background-image` makes the browser drop the whole declaration, which is
 * why the pattern has to be spread across two properties.
 */
export function wallpaperSize(id: WallpaperId): string {
  switch (id) {
    case "dots":
      return "18px 18px";
    case "grid":
      return "26px 26px";
    case "diagonal":
    case "waves":
    case "none":
    default:
      return "auto";
  }
}

/**
 * Whether a wallpaper should be dimmed.
 *
 * Light themes have less room between text and background, so the same pattern
 * that reads as a texture in the dark theme reads as noise on white.
 */
export function wallpaperOpacity(id: WallpaperId, theme: string): number {
  if (id === "none") return 0;
  return theme === "light" ? 0.035 : 0.07;
}
