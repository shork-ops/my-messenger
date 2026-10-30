/**
 * Contrast as a test rather than a one-off measurement.
 *
 * The H1 audit found four places where text sat at 1.6:1 to 3:1 against its background -
 * an own-message time that measured 1.61:1, avatar letters at 2.1:1 - and every one of them
 * had been invisible to the eye on a bright screen. A measurement catches them; a person
 * looking at the page does not. Doing it once means the next theme breaks the same places
 * in silence, so the palette is checked here on every run.
 *
 * The check works on the theme tokens in styles.css, not on a rendered page: jsdom does not
 * lay anything out, and the tokens are what the whole interface inherits from.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(here, "..", "styles.css"), "utf8");

/** Every theme the app ships. "default" is what :root holds. */
const THEMES = ["default", "light", "blue", "violet", "mint"] as const;
type Theme = (typeof THEMES)[number];

type Rgb = { r: number; g: number; b: number };

function parseHex(value: string): Rgb | null {
  const hex = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!hex) return null;
  const digits = hex[1];
  const full =
    digits.length === 3
      ? digits
          .split("")
          .map((char) => char + char)
          .join("")
      : digits;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.1 contrast ratio, 1..21. */
export function contrastRatio(foreground: Rgb, background: Rgb): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The custom properties declared for one theme.
 *
 * A theme block only overrides what it changes, so a value is taken from the nearest block
 * that declares it, falling back to :root - which is exactly how the browser resolves them.
 */
function tokensFor(theme: Theme): Record<string, string> {
  const rootBlock = CSS.match(/:root\s*\{([^}]*)\}/);
  const tokens: Record<string, string> = {};
  if (rootBlock) Object.assign(tokens, readBlock(rootBlock[1]));

  if (theme !== "default") {
    const block = CSS.match(new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([^}]*)\\}`));
    if (block) Object.assign(tokens, readBlock(block[1]));
  }
  return tokens;
}

function readBlock(body: string): Record<string, string> {
  const read: Record<string, string> = {};
  for (const declaration of body.split(";")) {
    const match = declaration.match(/(--[\w-]+)\s*:\s*([^;]+)/);
    if (!match) continue;
    const value = match[2].trim();
    // Gradients and shadows are not colours; only plain values are compared.
    if (/^#[0-9a-f]{3,6}$/i.test(value)) read[match[1]] = value;
  }
  return read;
}

/** Pairs that are actually drawn on top of one another in the interface. */
const PAIRS: { fg: string; bg: string; what: string; minimum: number }[] = [
  { fg: "--fg", bg: "--surface-1", what: "body text on a panel", minimum: 4.5 },
  { fg: "--fg", bg: "--surface-2", what: "body text on a raised panel", minimum: 4.5 },
  { fg: "--fg", bg: "--surface-3", what: "body text on the deepest panel", minimum: 4.5 },
  { fg: "--fg-secondary", bg: "--surface-1", what: "secondary text on a panel", minimum: 4.5 },
  { fg: "--fg-muted", bg: "--surface-1", what: "muted text on a panel", minimum: 4.5 },
  { fg: "--fg-muted", bg: "--surface-2", what: "muted text on a raised panel", minimum: 4.5 },
];

describe("theme contrast", () => {
  it("reads a palette for every theme", () => {
    for (const theme of THEMES) {
      const tokens = tokensFor(theme);
      expect(Object.keys(tokens).length, `${theme} has no tokens`).toBeGreaterThan(5);
    }
  });

  it("computes the WCAG ratio the way the spec does", () => {
    // Black on white is 21:1; a colour against itself is 1:1.
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 1);
    expect(contrastRatio({ r: 128, g: 128, b: 128 }, { r: 128, g: 128, b: 128 })).toBeCloseTo(1, 5);
  });

  for (const theme of THEMES) {
    it(`keeps every text pair readable in the ${theme} theme`, () => {
      const tokens = tokensFor(theme);
      const failures: string[] = [];

      for (const pair of PAIRS) {
        const fg = tokens[pair.fg];
        const bg = tokens[pair.bg];
        if (!fg || !bg) continue;
        const fgRgb = parseHex(fg);
        const bgRgb = parseHex(bg);
        if (!fgRgb || !bgRgb) continue;
        const ratio = contrastRatio(fgRgb, bgRgb);
        if (ratio < pair.minimum) {
          failures.push(`${pair.what}: ${pair.fg} ${fg} on ${pair.bg} ${bg} is ${ratio.toFixed(2)}:1, needs ${pair.minimum}`);
        }
      }

      expect(failures).toEqual([]);
    });
  }

  it("fails the check when a pair is deliberately made unreadable", () => {
    // A guard on the guard: text in the same colour as its own background must come out at
    // 1:1, and a pair the audit really did find bad - the light theme's own-message time at
    // 1.61:1 before it was fixed - must come out below the minimum, so a broken comparison
    // could not pass the real assertions above.
    const tokens = tokensFor("light");
    const surface = tokens["--surface-1"];
    expect(surface).toBeTruthy();
    const surfaceRgb = parseHex(surface) as Rgb;
    expect(contrastRatio(surfaceRgb, surfaceRgb)).toBeCloseTo(1, 5);

    const nearYellow = parseHex("#ffe27a") as Rgb;
    const nearSurface = parseHex("#f5f0dd") as Rgb;
    expect(contrastRatio(nearYellow, nearSurface)).toBeLessThan(4.5);
  });
});
