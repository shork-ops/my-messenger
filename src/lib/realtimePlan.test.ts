import { describe, expect, it } from "vitest";
import { planRealtimeMessage } from "./chats";
import type { Chat, Message } from "../types";

const message = (remoteId: string): Message => ({
  id: 1,
  remoteId,
  author: "Собеседник",
  text: "привет",
  time: "12:00",
  mine: false,
  createdAt: Date.UTC(2026, 9, 29, 12, 0),
  reactions: [],
});

const chat = (id: number, remoteId: string, messages: Message[] = []): Chat => ({
  id,
  remoteId,
  name: "Чат",
  avatar: "Ч",
  color: "#7b61ff",
  preview: "",
  time: "12:00",
  unread: 0,
  messages,
  members: [],
});

describe("planRealtimeMessage", () => {
  // Regression: a realtime INSERT can arrive before the chat list has loaded.
  // The hook used to \`return current\` in that case, which dropped the event, and
  // the message then appeared in neither the conversation nor the list.
  it("asks for a reload when the chat is not loaded yet", () => {
    expect(planRealtimeMessage([], "chat-remote", "message-1")).toEqual({ action: "reload", chatId: null });
  });

  it("asks for a reload when only other chats are loaded", () => {
    const chats = [chat(1, "other-chat", [])];
    expect(planRealtimeMessage(chats, "chat-remote", "message-1")).toEqual({ action: "reload", chatId: null });
  });

  it("appends when the chat is known and the message is new", () => {
    const chats = [chat(7, "chat-remote", [])];
    expect(planRealtimeMessage(chats, "chat-remote", "message-1")).toEqual({ action: "append", chatId: 7 });
  });

  it("skips a message that was already appended", () => {
    const chats = [chat(7, "chat-remote", [message("message-1")])];
    expect(planRealtimeMessage(chats, "chat-remote", "message-1")).toEqual({ action: "skip", chatId: 7 });
  });
});
