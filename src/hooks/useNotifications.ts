import { useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { badgeCount, formatDocumentTitle } from "../lib/notifications";
import { pushConfigured, subscribeToPush } from "../lib/push";
import { pushPromptAlreadySeen, rememberPushPrompt } from "../lib/pushPrompt";
import { VIBRATION_PATTERN, type NotificationPrefs, shouldPlaySound, shouldVibrate } from "../lib/notificationPrefs";

/**
 * Mirrors unread chats into the browser tab title and the installed-PWA badge.
 * Uses the Badging API where available and degrades to a no-op elsewhere.
 */
export function useUnreadBadge(unreadTotal: number) {
  useEffect(() => {
    document.title = formatDocumentTitle(unreadTotal);
    const navigatorWithBadge = navigator as Navigator & {
      setAppBadge?: (contents?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (typeof navigatorWithBadge.setAppBadge !== "function") return;
    const count = badgeCount(unreadTotal);
    const task = count > 0 ? navigatorWithBadge.setAppBadge?.(count) : navigatorWithBadge.clearAppBadge?.();
    task?.catch(() => {
      // Badging is best-effort: some contexts reject the promise.
    });
  }, [unreadTotal]);
}

type ChatSummary = { remoteId?: string; name: string; group?: boolean };

type UseMessageNotificationsOptions = {
  accountId: string | null;
  chats: ChatSummary[];
  prefs: NotificationPrefs;
};

/**
 * A short two-tone chime, synthesized rather than loaded.
 *
 * A bundled audio file is one more thing to fail to download on a slow
 * connection, and a message that arrives silently is worse than a plain sound.
 */
function playChime() {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const context = new Ctor();
    const now = context.currentTime;
    // Two notes a fifth apart, each fading out - recognizable without being shrill.
    for (const [time, frequency] of [
      [0, 880],
      [0.12, 1174],
    ] as const) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + time);
      gain.gain.exponentialRampToValueAtTime(0.16, now + time + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + time + 0.18);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now + time);
      oscillator.stop(now + time + 0.2);
    }
    // Release the audio context; browsers cap how many may exist.
    window.setTimeout(() => void context.close().catch(() => undefined), 600);
  } catch {
    // Autoplay policy refused: the notification itself still appears.
  }
}

/** Direct chats use the sender name as the title, groups prefix it with the chat title. */
export function notificationTitle(chatName: string, group: boolean): string {
  return group ? `Новое сообщение · ${chatName}` : chatName;
}

/**
 * Shows an OS notification for new messages while the tab is in the background.
 * Only covers the open-app case; the Web Push path is delivered by the service worker.
 */
export function useMessageNotifications({ accountId, chats, prefs }: UseMessageNotificationsOptions) {
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  useEffect(() => {
    const client = supabase;
    if (!client || !accountId) return;
    const channel = client
      .channel("nexus-notifications")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const row = payload.new as { chat_id?: string; sender_id?: string; body?: string; attachment?: unknown };
        if (!row?.chat_id || row.sender_id === accountId) return;
        if (document.visibilityState === "visible") return;
        if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
        const chat = chatsRef.current.find((item) => item.remoteId === row.chat_id);
        const body = row.attachment ? "Вложение" : row.body || "Новое сообщение";
        // Quiet hours silence sound and buzz, never the notification itself: a
        // message at 3am should still be there in the morning.
        const now = new Date();
        const current = prefsRef.current;
        if (shouldPlaySound(current, now)) playChime();
        if (shouldVibrate(current, now)) {
          try {
            navigator.vibrate?.(VIBRATION_PATTERN);
          } catch {
            // Vibration is missing on most desktops.
          }
        }
        try {
          const notification = new Notification(chat ? notificationTitle(chat.name, Boolean(chat.group)) : "Nexus", {
            body,
            icon: `${import.meta.env.BASE_URL}icons/icon-192.png`,
            tag: row.chat_id,
          });
          notification.onclick = () => {
            window.focus();
            notification.close();
          };
        } catch {
          // Notifications require a service worker on some mobile browsers.
        }
      })
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [accountId]);
}

/** Requests Notification permission on a user gesture; browsers require one for the first prompt. */
export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

/**
 * Keeps the stored push subscription in sync with the browser once the user has
 * already granted notification permission.
 *
 * Without this the subscription only ever exists because the user pressed the
 * bell: clearing site data, reinstalling the PWA or letting the push service
 * rotate the endpoint would leave the account receiving nothing, with no hint
 * in the UI. Re-running `subscribeToPush` is cheap — it reuses an existing
 * subscription and upserts the same row on (user_id, endpoint).
 *
 * It never prompts: permission must already be granted, otherwise the flow
 * stays behind the bell button.
 */
export function usePushSubscriptionSync(accountId: string | null) {
  const syncedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!accountId) return;
    if (!pushConfigured()) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    // Guard against StrictMode double-invocation and re-renders.
    if (syncedForRef.current === accountId) return;
    syncedForRef.current = accountId;

    let cancelled = false;
    void subscribeToPush(accountId).then((result) => {
      // Allow a later retry when the attempt failed for a transient reason.
      if (!cancelled && result !== "subscribed" && result !== "not-configured") syncedForRef.current = null;
    });
    return () => {
      cancelled = true;
    };
  }, [accountId]);
}

type UseNotificationsPromptOptions = {
  accountId: string | null;
  enabled: boolean;
  onNotice: (message: string) => void;
};

/**
 * Offers chat notifications right after the app starts, so a new user does not
 * have to discover the bell first.
 *
 * Browsers only show the permission prompt in response to a user gesture, so
 * the request is bound to the first click/keystroke after the app is ready. It
 * fires at most once per browser and only while permission is still
 * "default" — a denied permission is respected and never re-asked.
 */
export function useNotificationsPrompt({ accountId, enabled, onNotice }: UseNotificationsPromptOptions) {
  const noticeRef = useRef(onNotice);
  noticeRef.current = onNotice;

  useEffect(() => {
    if (!enabled || !accountId) return;
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "default") return;
    if (pushPromptAlreadySeen(accountId)) return;

    let done = false;
    const request = async () => {
      if (done) return;
      done = true;
      remove();
      rememberPushPrompt(accountId);
      const permission = await requestNotificationPermission();
      if (permission === "granted") {
        const result = await subscribeToPush(accountId);
        if (result === "subscribed") noticeRef.current("Уведомления включены, в том числе в фоне");
        else if (result === "push-service") noticeRef.current("Push-служба браузера недоступна: перезапусти браузер или проверь VPN");
        else noticeRef.current("Уведомления включены");
      } else if (permission === "denied") {
        noticeRef.current("Уведомления запрещены в браузере — включи их в настройках сайта");
      }
    };

    const events = ["pointerdown", "keydown", "touchstart"] as const;
    const remove = () => {
      for (const event of events) window.removeEventListener(event, request);
    };
    for (const event of events) window.addEventListener(event, request, { passive: true, once: true });

    return () => {
      remove();
    };
  }, [accountId, enabled]);
}
