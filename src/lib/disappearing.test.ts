import { describe, expect, it } from "vitest";
import { chatsForStorage, deadlineTitle, isDisappearingSeconds, ttlLabel } from "./disappearing";
import { canChangeTimer, setChatTimer, sweepDeadlines, timerErrorMessage, timerNotice } from "./disappearingLive";
import type { Chat, Message } from "../types";

const HOUR = 3600;
const T = 1_800_000_000_000;

function chat(overrides: Partial<Chat> = {}, messages: Message[] = []): Chat {
  return { id: 1, name: "Аня", avatar: "А", color: "blue", preview: "", time: "", messages, ...overrides };
}

function message(id: number, overrides: Partial<Message> = {}): Message {
  return { id, author: "Я", text: `сообщение ${id}`, time: "12:00", createdAt: T, ...overrides };
}

const deadlines = (item: Chat) => item.messages.map((entry) => entry.disappearsAt);

describe("timer options", () => {
  it("accepts only the timers the server accepts", () => {
    expect([3600, 86_400, 604_800, 2_592_000].every(isDisappearingSeconds)).toBe(true);
    expect([0, 1, 60, null, undefined, "3600", 3601].some(isDisappearingSeconds)).toBe(false);
  });

  it("names each timer and confirms a change", () => {
    expect(ttlLabel(null)).toBe("Выключено");
    expect(ttlLabel(undefined)).toBe("Выключено");
    expect(ttlLabel(604_800)).toBe("1 неделя");
    expect(timerNotice(604_800)).toBe("Исчезающие сообщения: 1 неделя");
    expect(timerNotice(null)).toBe("Исчезающие сообщения выключены");
  });
});

describe("canChangeTimer", () => {
  it("lets either person change it in a direct or local chat", () => {
    expect(canChangeTimer(chat({ remoteId: "c1" }), null)).toBe(true);
    expect(canChangeTimer(chat(), null)).toBe(true);
  });

  it("leaves it to owners and admins in a group", () => {
    const group = chat({ remoteId: "g1", group: true });
    expect(canChangeTimer(group, "member")).toBe(false);
    expect(canChangeTimer(group, null)).toBe(false);
    expect(canChangeTimer(group, "admin")).toBe(true);
    expect(canChangeTimer(group, "owner")).toBe(true);
  });

  it("leaves it to the owner in a channel", () => {
    expect(canChangeTimer(chat({ channel: true, channelRole: "subscriber" }), null)).toBe(false);
    expect(canChangeTimer(chat({ channel: true, channelRole: "author" }), null)).toBe(false);
    expect(canChangeTimer(chat({ channel: true, channelRole: "owner" }), null)).toBe(true);
  });
});

describe("sweepDeadlines: giving messages their deadline", () => {
  it("times only messages written after the timer was switched on", () => {
    const timed = chat({ messageTtlSeconds: HOUR, messageTtlSince: T }, [message(1, { createdAt: T - 1 }), message(2, { createdAt: T + 1000 })]);
    const { chats, next } = sweepDeadlines([timed], T + 1000);
    expect(deadlines(chats[0])).toEqual([undefined, T + 1000 + HOUR * 1000]);
    expect(next).toBe(T + 1000 + HOUR * 1000);
  });

  it("starts a scheduled message's countdown at delivery", () => {
    const timed = chat({ messageTtlSeconds: HOUR, messageTtlSince: T }, [message(1, { sendAt: T + 5000 })]);
    expect(deadlines(sweepDeadlines([timed], T).chats[0])).toEqual([T + 5000 + HOUR * 1000]);
  });

  it("in a cloud chat times only this device's accepted messages, leaving the rest to the server", () => {
    const cloud = chat({ remoteId: "c1", messageTtlSeconds: HOUR, messageTtlSince: T }, [
      message(1, { mine: true, remoteId: "m1" }),
      message(2, { mine: true, remoteId: "m2", delivery: "sending" }),
      message(3, { mine: true, remoteId: "m3", delivery: "failed" }),
      message(4, { remoteId: "m4" }),
    ]);
    expect(deadlines(sweepDeadlines([cloud], T).chats[0]).map((at) => at !== undefined)).toEqual([true, false, false, false]);
  });

  it("returns the same list when there is nothing to do", () => {
    const steady = [chat({ messageTtlSeconds: HOUR, messageTtlSince: T }, [message(1, { disappearsAt: T + 5 })])];
    expect(sweepDeadlines(steady, T).chats).toBe(steady);
    const off = [chat({}, [message(1)])];
    expect(sweepDeadlines(off, T)).toEqual({ chats: off, next: null });
  });
});

describe("sweepDeadlines: removing what is due", () => {
  it("removes a message at its deadline and keeps the preview in step", () => {
    const chats = [chat({ preview: "сообщение 2", time: "12:01" }, [message(1, { time: "12:00" }), message(2, { time: "12:01", disappearsAt: T })])];
    expect(sweepDeadlines(chats, T - 1).chats).toBe(chats);
    const [next] = sweepDeadlines(chats, T).chats;
    expect(next.messages.map((item) => item.id)).toEqual([1]);
    expect(next).toMatchObject({ preview: "сообщение 1", time: "12:00" });
  });

  it("says the chat is empty when the last message goes", () => {
    const [next] = sweepDeadlines([chat({}, [message(1, { disappearsAt: T - 1 })])], T).chats;
    expect(next.messages).toEqual([]);
    expect(next.preview).toBe("Нет сообщений");
  });

  it("leaves the preview alone when an older message goes", () => {
    const chats = [chat({ preview: "📎 фото" }, [message(1, { disappearsAt: T }), message(2)])];
    expect(sweepDeadlines(chats, T).chats[0].preview).toBe("📎 фото");
  });

  it("reports the earliest deadline still ahead across chats", () => {
    const chats = [
      chat({ id: 1 }, [message(1, { disappearsAt: T + 50 }), message(2)]),
      chat({ id: 2 }, [message(3, { disappearsAt: T + 10 }), message(4, { disappearsAt: T - 10 })]),
    ];
    expect(sweepDeadlines(chats, T).next).toBe(T + 10);
  });
});

describe("chatsForStorage", () => {
  it("never writes a timed cloud message to this device, and never an expired local one", () => {
    const chats = [
      chat({ id: 1, remoteId: "c1" }, [message(1, { disappearsAt: T + HOUR * 1000 }), message(2)]),
      chat({ id: 2 }, [message(3, { disappearsAt: T - 1 }), message(4, { disappearsAt: T + 1 })]),
    ];
    const stored = chatsForStorage(chats, T);
    expect(stored[0].messages.map((item) => item.id)).toEqual([2]);
    expect(stored[1].messages.map((item) => item.id)).toEqual([4]);
    expect(chatsForStorage(stored, T)).toEqual(stored);
  });

  it("does not keep a timed message's text as the chat preview", () => {
    const timedLast = chat({ id: 1, remoteId: "c1", preview: "секрет", time: "12:05" }, [
      message(1, { text: "привет", time: "12:00" }),
      message(2, { text: "секрет", time: "12:05", disappearsAt: T + HOUR * 1000 }),
    ]);
    const onlyTimed = chat({ id: 2, remoteId: "c2", preview: "секрет", time: "12:05" }, [message(3, { text: "секрет", disappearsAt: T + 1 })]);
    const untimed = chat({ id: 3, remoteId: "c3", preview: "привет" }, [message(4, { text: "привет" })]);
    const [first, second, third] = chatsForStorage([timedLast, onlyTimed, untimed], T);
    expect(first).toMatchObject({ preview: "привет", time: "12:00" });
    expect(second).toMatchObject({ messages: [], preview: "Нет сообщений", time: "" });
    expect(third).toBe(untimed);
  });
});

describe("deadlineTitle", () => {
  it("tells when the message goes", () => {
    expect(deadlineTitle(new Date(2026, 10, 2, 14, 30).getTime())).toBe("Исчезнет 02.11.2026, 14:30");
  });
});

describe("setChatTimer", () => {
  it("records when the timer started and leaves an unchanged timer alone", () => {
    const chats = [chat({ id: 1, remoteId: "c1" }), chat({ id: 2 })];
    const next = setChatTimer(chats, (item) => item.remoteId === "c1", HOUR, T);
    expect(next[0]).toMatchObject({ messageTtlSeconds: HOUR, messageTtlSince: T });
    expect(next[1]).toBe(chats[1]);
    expect(setChatTimer(next, (item) => item.remoteId === "c1", HOUR, T + 5)).toBe(next);
    expect(setChatTimer(next, (item) => item.remoteId === "c1", null, T + 5)[0].messageTtlSeconds).toBeNull();
  });
});

describe("timerErrorMessage", () => {
  it("tells the person what went wrong", () => {
    expect(timerErrorMessage({ code: "PGRST202", message: "Could not find the function public.set_chat_message_ttl" })).toMatch(/миграция 20261052/);
    expect(timerErrorMessage({ code: "42501", message: "Only admins can change the timer here" })).toBe("Таймер в этом чате меняют только админы");
    expect(timerErrorMessage({ code: "42501", message: "Not a member of this chat" })).toBe("Нет прав менять таймер в этом чате");
    expect(timerErrorMessage({ message: "TypeError: Failed to fetch" })).toBe("Нет соединения — таймер не изменён");
    expect(timerErrorMessage(null)).toBe("Не удалось изменить таймер. Попробуй ещё раз");
  });
});
