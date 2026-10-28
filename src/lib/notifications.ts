/** Shortens the browser tab title when there are unread messages. */
export function formatDocumentTitle(unread: number, appName = "Nexus"): string {
  return unread > 0 ? `(${unread}) ${appName}` : appName;
}

/** The Badging API accepts integers only; clamp to keep the badge readable. */
export function badgeCount(unread: number): number {
  return Math.max(0, Math.min(unread, 99));
}
