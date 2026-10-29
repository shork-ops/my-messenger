/** Shortens the browser tab title when there are unread messages. */
export function formatDocumentTitle(unread: number, appName = "Nexus"): string {
  return unread > 0 ? `(${unread}) ${appName}` : appName;
}

/** The Badging API accepts integers only; clamp to keep the badge readable. */
export function badgeCount(unread: number): number {
  return Math.max(0, Math.min(unread, 99));
}

/**
 * What a badge may show.
 *
 * Past a hundred the exact number stops meaning anything and starts breaking the
 * layout, so it becomes "99+".
 */
export function badgeText(unread: number): string {
  if (unread <= 0) return "";
  return unread > 99 ? "99+" : String(unread);
}
