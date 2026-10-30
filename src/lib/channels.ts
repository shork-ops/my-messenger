/**
 * Channels.
 *
 * A channel is a chat where only the owner and its authors write, and everyone else reads.
 * The rules that matter are here rather than spread through the composer, the header and the
 * list, because those three must never disagree: a composer that refuses to type while the
 * header offers a reply box is worse than either behaviour alone.
 */

export type ChannelRole = "owner" | "author" | "subscriber";

export type ChannelDesign = {
  /** The channel's own colour, used in its header and its place in the list. */
  accent: string | null;
  /** Image shown across the top of the channel. */
  cover: string | null;
  /** The message shown as the channel's shop window. */
  pinned: number | null;
};

export const DEFAULT_ACCENT = "#f0b429";

const ROLES: ChannelRole[] = ["owner", "author", "subscriber"];

export function isChannelRole(value: unknown): value is ChannelRole {
  return typeof value === "string" && (ROLES as string[]).includes(value);
}

/**
 * Whether this role may write in a channel.
 *
 * Unknown roles read. Failing the other way would let anyone post anywhere by arriving with a
 * role the client has not heard of yet.
 */
export function canPostToChannel(role: string | null | undefined): boolean {
  return role === "owner" || role === "author";
}

/** "21 подписчик", "3 подписчика", "11 подписчиков". */
export function subscriberLabel(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 14) return `${count} подписчиков`;
  if (ones === 1) return `${count} подписчик`;
  if (ones >= 2 && ones <= 4) return `${count} подписчика`;
  return `${count} подписчиков`;
}

/**
 * The line under a channel's name.
 *
 * A description is more useful than a subscriber count to someone deciding whether to read,
 * so it wins when present. A zero count is not shown at all: "0 подписчиков" reads as a
 * channel nobody wants, which is not what a freshly made one is.
 */
export function channelSubtitle(count: number, unread: number, description?: string | null): string {
  if (description && description.trim() !== "") return description.trim();
  if (count <= 0) return "";
  const label = subscriberLabel(count);
  return unread > 0 ? `${label} · ${unread} новых` : label;
}

/** A six-digit hex colour, or null. Anything else could break out of a style value. */
export function parseAccent(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
}

/** The colour to paint a channel with. */
export function channelAccent(accent: string | null | undefined): string {
  return parseAccent(accent) ?? DEFAULT_ACCENT;
}

function safeImage(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  return /^https?:\/\//i.test(value.trim()) ? value.trim() : null;
}

/** Reads a stored design, refusing anything that would be dangerous to render. */
export function parseChannelDesign(raw: string | null | undefined): ChannelDesign {
  const empty: ChannelDesign = { accent: null, cover: null, pinned: null };
  if (!raw) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (!parsed || typeof parsed !== "object") return empty;
  const record = parsed as Record<string, unknown>;
  const pinned = record.pinned;
  return {
    accent: parseAccent(record.accent),
    cover: safeImage(record.cover),
    pinned: typeof pinned === "number" && Number.isFinite(pinned) ? pinned : null,
  };
}

/** The stored form: unsafe values are dropped rather than saved and filtered later. */
export function serializeChannelDesign(design: ChannelDesign): string {
  return JSON.stringify({
    accent: parseAccent(design.accent),
    cover: safeImage(design.cover),
    pinned: design.pinned ?? null,
  });
}
