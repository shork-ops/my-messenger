import { useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { badgeCount, formatDocumentTitle } from "../lib/notifications";

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
};

/** Direct chats use the sender name as the title, groups prefix it with the chat title. */
export function notificationTitle(chatName: string, group: boolean): string {
  return group ? `Новое сообщение · ${chatName}` : chatName;
}

/**
 * Shows an OS notification for new messages while the tab is in the background.
 * Only covers the open-app case; the Web Push path is delivered by the service worker.
 */
export function useMessageNotifications({ accountId, chats }: UseMessageNotificationsOptions) {
  const chatsRef = useRef(chats);
  chatsRef.current = chats;

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
