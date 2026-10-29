import { describe, expect, it } from "vitest";
import {
  describeCallEnd,
  describeCallError,
  formatCallDuration,
  isLive,
  presentCall,
  toActiveCall,
  type ActiveCall,
  type CallRow,
} from "./calls";

const row = (overrides: Partial<CallRow> = {}): CallRow => ({
  id: "call-1",
  chat_id: "chat-1",
  created_by: "user-a",
  kind: "audio",
  status: "ringing",
  started_at: "2026-10-29T10:00:00.000Z",
  answered_at: null,
  ended_at: null,
  room_name: "call-abc",
  ...overrides,
});

const active = (overrides: Partial<ActiveCall> = {}): ActiveCall => ({
  id: "call-1",
  chatId: "chat-1",
  kind: "audio",
  status: "ringing",
  startedAt: 1_700_000_000_000,
  createdBy: "user-a",
  mine: false,
  remoteId: null,
  ...overrides,
});

describe("isLive", () => {
  it("treats ringing and active as live", () => {
    expect(isLive("ringing")).toBe(true);
    expect(isLive("active")).toBe(true);
  });

  it("treats every finished state as not live", () => {
    expect(isLive("ended")).toBe(false);
    expect(isLive("missed")).toBe(false);
    expect(isLive("declined")).toBe(false);
  });
});

describe("toActiveCall", () => {
  it("marks the caller's own call", () => {
    expect(toActiveCall(row(), "user-a").mine).toBe(true);
  });

  it("marks a peer's call as not mine", () => {
    expect(toActiveCall(row(), "user-b").mine).toBe(false);
  });

  it("parses the start time once, so the UI does not re-parse strings", () => {
    expect(toActiveCall(row(), "user-a").startedAt).toBe(Date.parse("2026-10-29T10:00:00.000Z"));
  });
});

describe("presentCall", () => {
  it("shows nothing without a call", () => {
    expect(presentCall(null)).toBe("hidden");
  });

  it("shows an outgoing screen to the caller", () => {
    expect(presentCall(active({ mine: true, status: "ringing" }))).toBe("outgoing");
  });

  it("shows an incoming screen to the peer", () => {
    expect(presentCall(active({ mine: false, status: "ringing" }))).toBe("incoming");
  });

  it("shows the in-call screen once answered, for both sides", () => {
    expect(presentCall(active({ status: "active", mine: true }))).toBe("incall");
    expect(presentCall(active({ status: "active", mine: false }))).toBe("incall");
  });

  it("hides the call once it is finished, so a banner cannot linger", () => {
    expect(presentCall(active({ status: "ended" }))).toBe("hidden");
    expect(presentCall(active({ status: "declined" }))).toBe("hidden");
  });
});

describe("formatCallDuration", () => {
  it("formats under a minute", () => {
    expect(formatCallDuration(9_000)).toBe("0:09");
  });

  it("pads seconds past a minute", () => {
    expect(formatCallDuration(65_000)).toBe("1:05");
  });

  it("handles long calls", () => {
    expect(formatCallDuration(3_725_000)).toBe("62:05");
  });

  it("never shows a negative or broken time", () => {
    expect(formatCallDuration(-5)).toBe("0:00");
    expect(formatCallDuration(Number.NaN)).toBe("0:00");
  });
});

describe("describeCallEnd", () => {
  it("names each final state", () => {
    expect(describeCallEnd("declined")).toBe("Звонок отклонён");
    expect(describeCallEnd("missed")).toBe("Пропущенный звонок");
    expect(describeCallEnd("ended")).toBe("Звонок завершён");
  });
});

describe("describeCallError", () => {
  it("turns a missing provider into a user-facing message", () => {
    expect(describeCallError("Calling is not configured")).toBe("Звонки пока не подключены");
  });

  it("explains a chat that already has a call", () => {
    expect(describeCallError("A call is already in progress in this chat")).toBe("В этом чате уже идёт звонок");
  });

  it("explains a block", () => {
    expect(describeCallError("Cannot call a blocked user")).toBe("Пользователь вас заблокировал");
  });

  it("falls back to a generic message", () => {
    expect(describeCallError(undefined)).toBe("Не удалось начать звонок");
    expect(describeCallError("something unexpected")).toBe("Не удалось начать звонок");
  });
});
