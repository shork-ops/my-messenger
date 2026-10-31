/**
 * How much space this device is using.
 *
 * The two numbers people actually care about are different: the browser cache is
 * safe to throw away, and the media is the part that costs bandwidth to fetch
 * again. They are reported separately rather than added together, because
 * "1.2 ГБ" of cache is a very different thing from 1.2 ГБ of photos.
 */

/** Total bytes of the files this account has uploaded or received. */
export function mediaBytes(messages: { attachment?: { size?: number } | null }[]): number {
  return messages.reduce((sum, message) => sum + (message.attachment?.size ?? 0), 0);
}

/**
 * Human-readable size.
 *
 * Re-exported from media.ts rather than reimplemented: two copies of the same
 * formatter drift, and the storage row would then disagree with the upload error
 * message about the very same file.
 */
export { formatBytes } from "./media";

/** Local alias: the re-export above does not bind a name in this module. */
import { formatBytes } from "./media";
import { ownerFor, scopedKey } from "./accountScope";

/**
 * Every local-storage key this app owns, so "clear cache" cannot miss one or hit a stranger's.
 *
 * These are the *logical* names. Since caches became per account they are stored under the
 * account's namespace, so the real key is `scopedKey(owner, name)` - see `cacheKeysFor`. The bare
 * names are kept because clearing a cache has to work for entries written before the split as
 * well, and because this list is what the settings screen reports.
 */
export const CACHE_KEYS = [
  "nexus-theme",
  "nexus-text-size",
  "nexus-notification-prefs",
  "nexus-message-sounds",
  "nexus-wallpaper",
  "nexus-language",
  "nexus-push-prompted",
  "nexus-push-asked",
  "nexus-chat-folders",
  "nexus-privacy-prefs",
  "nexus-media-policy",
  "nexus-chats-v1",
  "nexus-drafts-v1",
  "nexus-reply-drafts-v1",
  "nexus-view-once-spent",
  "nexus-profile-name",
  "nexus-profile-avatar",
] as const;

/**
 * The real storage keys for one account, plus the bare legacy names.
 *
 * Clearing the cache must clear *this account's* cache: on a shared browser, wiping the other
 * person's drafts is not a cache clear, it is data loss. The bare names are included because a
 * pre-split entry left behind is still this device's cache and still safe to drop.
 */
export function cacheKeysFor(accountId: string | null): string[] {
  const owner = ownerFor(accountId);
  return [...CACHE_KEYS.map((key) => scopedKey(owner, key)), ...CACHE_KEYS];
}

/**
 * Which of these keys actually exist right now.
 *
 * Clearing a cache means removing exactly what is there; a fixed list that is
 * removed blindly hides typos, because removing a key that never existed looks
 * the same as succeeding.
 */
export function presentCacheKeys(keys: readonly string[], has: (key: string) => boolean): string[] {
  return keys.filter((key) => has(key));
}

/** What the storage row says. */
export function storageSummary(bytes: number, messageCount: number): string {
  if (messageCount === 0) return "Вложений пока нет";
  return `${formatBytes(bytes)} в ${messageCount} ${plural(messageCount, "вложении", "вложениях", "вложениях")}`;
}

/** Russian plural picker: 1 вложение, 2 вложения, 5 вложений. */
export function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = Math.abs(count) % 10;
  const mod100 = Math.abs(count) % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
