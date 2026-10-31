import { afterEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendText } from "./sendText";
afterEach(() => vi.useRealTimers());

it("rejects an overlong draft before touching the network", async () => {
  const from = vi.fn();
  await expect(sendText({ from } as unknown as SupabaseClient, { id:"id",chat_id:"chat",sender_id:"a",body:"a".repeat(10001) })).rejects.toThrow("10 000");
  expect(from).not.toHaveBeenCalled();
});

it("recovers a lost insert response without inserting a duplicate message", async () => {
  vi.useFakeTimers();
  const insert = vi.fn().mockReturnThis();
  const single = vi.fn()
    .mockResolvedValueOnce({ error: { message: "Failed to fetch" } })
    .mockResolvedValueOnce({ error: { code: "23505" } })
    .mockResolvedValueOnce({ data: { id: "stable-id", body: "hello", created_at: "2026-10-31T00:00:00Z" } });
  const chain = { insert, select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single };
  const client = { from: () => chain } as unknown as SupabaseClient;
  const message = { id: "stable-id", body: "hello", sender_id: "sender", chat_id: "chat" };
  const pending = sendText(client, message);
  await vi.runAllTimersAsync();
  expect((await pending).id).toBe("stable-id");
  expect(insert.mock.calls.map(([row]) => row.id)).toEqual(["stable-id", "stable-id"]);
});

it("does not retry a permission denial", async () => {
  const insert = vi.fn().mockReturnThis();
  const chain = { insert, select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ error: { code: "42501", message: "denied" } }) };
  await expect(sendText({ from: () => chain } as unknown as SupabaseClient, { id: "id", body: "hi", sender_id: "a", chat_id: "c" })).rejects.toMatchObject({ code: "42501" });
  expect(insert).toHaveBeenCalledTimes(1);
});
