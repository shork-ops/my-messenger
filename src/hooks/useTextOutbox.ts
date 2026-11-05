import { withOutboxLock } from "../lib/outboxLock";
import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { supabase } from "../lib/supabase";
import { numericId, clockTime } from "../lib/format";
import { sendText } from "../lib/sendText";
import { placeNewMessage } from "../lib/messageOrder";
import { isTransientError } from "../lib/retry";
import type { Chat, Message, ReplyPreview } from "../types";

type Pending = {
  chatId: number;
  remoteChatId: string;
  senderId: string;
  message: Message;
  uuid: string;
  body?: string;
  attempts?: number;
  nextAttemptAt?: number;
  retryable?: boolean;
};
type Queue = {
  owner: string;
  alive: boolean;
  pending: Map<number, Pending>;
  busy: boolean;
  running: number | null;
};
const prefix = (owner: string) => `nexus-outbox:${owner}:`;
const key = (entry: Pending) => prefix(entry.senderId) + entry.uuid;
function save(entry: Pending): boolean {
  try {
    localStorage.setItem(key(entry), JSON.stringify(entry));
    return true;
  } catch {
    return false;
  }
}
function remove(entry: Pending): boolean {
  try {
    localStorage.removeItem(key(entry));
    const legacyKey = `nexus-outbox:${entry.senderId}`;
    const raw = localStorage.getItem(legacyKey);
    if (raw) {
      let legacy: unknown;
      try {
        legacy = JSON.parse(raw);
      } catch {
        return true;
      }
      if (Array.isArray(legacy)) {
        const remaining = legacy.filter((item) => item?.uuid !== entry.uuid);
        if (remaining.length) localStorage.setItem(legacyKey, JSON.stringify(remaining));
        else localStorage.removeItem(legacyKey);
      }
    }
    return true;
  } catch {
    return false;
  }
}
function read(owner: string): Pending[] {
  const found = new Map<string, Pending>();
  const accept = (entry: Pending) => {
    if (
      entry?.senderId === owner &&
      typeof entry.uuid === "string" &&
      typeof entry.remoteChatId === "string" &&
      typeof entry.chatId === "number" &&
      typeof entry.message?.id === "number" &&
      typeof entry.message.text === "string"
    ) {
      entry.message = { ...entry.message, outboxId: entry.uuid };
      found.set(entry.uuid, entry);
    }
  };
  try {
    // Migrate the old array only after each record has been saved successfully.
    const legacy = JSON.parse(localStorage.getItem(`nexus-outbox:${owner}`) || "[]");
    let migrated = true;
    if (Array.isArray(legacy))
      for (const entry of legacy) {
        accept(entry);
        if (entry?.senderId === owner && !save(entry)) migrated = false;
      }
    if (migrated) localStorage.removeItem(`nexus-outbox:${owner}`);
    for (let i = 0; i < localStorage.length; i++) {
      const name = localStorage.key(i);
      if (name?.startsWith(prefix(owner))) {
        try {
          accept(JSON.parse(localStorage.getItem(name) || "null"));
        } catch {
          /* Keep other valid records. */
        }
      }
    }
  } catch {
    /* Locked storage is reported when accepting a new message. */
  }
  return [...found.values()].sort((a, b) => (a.message.createdAt ?? 0) - (b.message.createdAt ?? 0));
}

export function useTextOutbox({
  accountId,
  profileName,
  chats,
  setChats,
  notify = () => {},
}: {
  accountId: string | null;
  profileName: string;
  chats: Chat[];
  setChats: Dispatch<SetStateAction<Chat[]>>;
  notify?: (text: string) => void;
}) {
  const current = useRef({ accountId, chats, notify });
  current.current = { accountId, chats, notify };
  const queue = useRef<Queue | null>(null);
  const valid = (state: Queue) =>
    state.alive && queue.current === state && current.current.accountId === state.owner;
  const patch = (state: Queue, entry: Pending, delivery: Message["delivery"]) => {
    if (!valid(state)) return;
    entry.message = { ...entry.message, delivery };
    save(entry);
    setChats((items) =>
      !valid(state)
        ? items
        : items.map((chat) =>
            chat.remoteId === entry.remoteChatId
              ? {
                  ...chat,
                  messages: chat.messages.map((message) =>
                    message.id === entry.message.id ? { ...message, delivery } : message,
                  ),
                }
              : chat,
          ),
    );
  };
  const drain = useCallback(async () => {
    const state = queue.current;
    if (!state || !valid(state) || state.busy || !state.pending.size || !supabase || !navigator.onLine)
      return;
    state.busy = true;
    const deliver = async () => {
      // Refresh records before sending: another tab may have acknowledged/deleted one.
      const disk = new Map(read(state.owner).map((entry) => [entry.uuid, entry]));
      for (const entry of [...state.pending.values()]) {
        if (!valid(state) || !navigator.onLine) break;
        if (!disk.has(entry.uuid)) {
          state.pending.delete(entry.message.id);
          continue;
        }
        if (
          entry.retryable === false ||
          (entry.nextAttemptAt ?? 0) > Date.now() ||
          !current.current.chats.some((chat) => chat.remoteId === entry.remoteChatId)
        )
          continue;
        state.running = entry.message.id;
        patch(state, entry, "sending");
        try {
          const row = await sendText(supabase!, {
            id: entry.uuid,
            chat_id: entry.remoteChatId,
            sender_id: state.owner,
            body: entry.body ?? entry.message.text,
          });
          if (!valid(state)) break;
          const sent = {
            ...entry.message,
            remoteId: row.id,
            createdAt: Date.parse(row.created_at),
            historyAt: row.created_at,
            time: clockTime(new Date(row.created_at)),
            delivery: "sent" as const,
          };
          state.pending.delete(entry.message.id);
          remove(entry);
          setChats((items) =>
            items.map((chat) =>
              chat.remoteId === entry.remoteChatId
                ? {
                    ...chat,
                    messages: placeNewMessage(
                      chat.messages.filter(
                        (message) => message.id !== entry.message.id && message.remoteId !== row.id,
                      ),
                      sent,
                    ),
                  }
                : chat,
            ),
          );
        } catch (error) {
          if (!valid(state)) break;
          entry.attempts = (entry.attempts ?? 0) + 1;
          entry.retryable = isTransientError(error) || !navigator.onLine;
          entry.nextAttemptAt = Date.now() + Math.min(30_000, 1000 * 2 ** Math.min(entry.attempts - 1, 5));
          patch(state, entry, entry.retryable ? "queued" : "failed");
          if (entry.retryable) break;
        } finally {
          state.running = null;
        }
      }
    };
    try {
      await withOutboxLock(`nexus-text-outbox:${state.owner}`, deliver);
    } finally {
      state.busy = false;
    }
  }, [setChats]);
  useEffect(() => {
    if (!accountId) {
      queue.current = null;
      return;
    }
    const state: Queue = { owner: accountId, alive: true, pending: new Map(), busy: false, running: null };
    for (const entry of read(accountId)) {
      entry.message = { ...entry.message, delivery: entry.retryable === false ? "failed" : "queued" };
      state.pending.set(entry.message.id, entry);
    }
    queue.current = state;
    const retry = () => {
      if (valid(state)) void drain();
    };
    const online = () => {
      for (const entry of state.pending.values()) if (entry.retryable !== false) entry.nextAttemptAt = 0;
      retry();
    };
    const visible = () => {
      if (document.visibilityState === "visible") retry();
    };
    const storage = (event: StorageEvent) => {
      if (event.key?.startsWith(prefix(state.owner))) {
        const entries = read(state.owner);
        state.pending = new Map(entries.map((entry) => [entry.message.id, entry]));
        retry();
      }
    };
    const timer = setInterval(visible, 1000);
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("storage", storage);
    return () => {
      state.alive = false;
      clearInterval(timer);
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("storage", storage);
    };
  }, [accountId, drain]);
  useEffect(() => {
    const state = queue.current;
    if (!state || !valid(state)) return;
    // A server row is acknowledgement even if the insert's response was lost.
    const acknowledged: Pending[] = [];
    for (const entry of state.pending.values()) {
      if (
        chats.some(
          (chat) =>
            chat.remoteId === entry.remoteChatId &&
            chat.messages.some((message) => message.remoteId === entry.uuid),
        )
      ) {
        state.pending.delete(entry.message.id);
        remove(entry);
        acknowledged.push(entry);
      }
    }
    if (state.pending.size || acknowledged.length)
      setChats((items) => {
        if (!valid(state)) return items;
        let changed = false;
        const next = items.map((chat) => {
          let messages = chat.messages;
          const confirmed = acknowledged.filter((entry) => entry.remoteChatId === chat.remoteId);
          if (confirmed.length) {
            messages = messages.filter(
              (message) => message.remoteId || !confirmed.some((entry) => entry.message.id === message.id),
            );
            if (messages.length !== chat.messages.length) changed = true;
          }
          for (const entry of state.pending.values()) {
            if (entry.remoteChatId !== chat.remoteId) continue;
            const existing = messages.find((message) => message.id === entry.message.id);
            if (!existing) {
              messages = placeNewMessage(messages, entry.message);
              changed = true;
            } else if (state.running !== entry.message.id && existing.delivery !== entry.message.delivery) {
              messages = messages.map((message) =>
                message.id === entry.message.id ? { ...message, delivery: entry.message.delivery } : message,
              );
              changed = true;
            }
          }
          return messages === chat.messages ? chat : { ...chat, messages };
        });
        return changed ? next : items;
      });
    void drain();
  }, [accountId, chats, setChats, drain]);
  const retryMessage = useCallback(
    async (id: number) => {
      const state = queue.current,
        entry = state?.pending.get(id);
      if (!state || !entry || state.owner !== accountId || !valid(state)) return;
      entry.retryable = true;
      entry.nextAttemptAt = 0;
      patch(state, entry, "queued");
      await drain();
    },
    [accountId, drain],
  );
  const queueText = useCallback(
    (chat: Chat, text: string, replyTo?: ReplyPreview, options?: { body: string; stickerId: string }) => {
      const state = queue.current;
      if (!accountId || !chat.remoteId || !state || state.owner !== accountId || !valid(state)) return false;
      if (read(accountId).length >= 100) {
        current.current.notify("Очередь заполнена. Дождись отправки сообщений; текст остаётся в черновике.");
        return false;
      }
      const uuid = crypto.randomUUID(),
        now = Date.now();
      const message: Message = {
        id: numericId(uuid),
        outboxId: uuid,
        author: profileName,
        text,
        mine: true,
        createdAt: now,
        time: clockTime(new Date(now)),
        replyTo,
        delivery: "queued",
        ...(options ? { stickerId: options.stickerId } : {}),
      };
      const entry: Pending = {
        chatId: chat.id,
        remoteChatId: chat.remoteId,
        senderId: accountId,
        message,
        uuid,
        body: options?.body,
        retryable: true,
      };
      if (!save(entry)) {
        current.current.notify("Не удалось сохранить сообщение на устройстве. Текст остаётся в черновике.");
        return false;
      }
      state.pending.set(message.id, entry);
      setChats((items) =>
        !valid(state)
          ? items
          : items.map((item) =>
              item.remoteId === chat.remoteId
                ? {
                    ...item,
                    preview: text,
                    time: message.time,
                    messages: placeNewMessage(item.messages, message),
                  }
                : item,
            ),
      );
      void drain();
      return true;
    },
    [accountId, profileName, drain, setChats],
  );
  const cancelQueuedMessage = useCallback(
    (id: number): boolean | undefined => {
      const state = queue.current,
        entry = state?.pending.get(id);
      if (!state || !entry || state.owner !== accountId || !valid(state)) return undefined;
      if (state.running === id || !remove(entry)) return false;
      state.pending.delete(id);
      return true;
    },
    [accountId],
  );
  return { queueText, retryMessage, cancelQueuedMessage };
}
