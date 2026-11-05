import { beforeEach, expect, it, vi } from "vitest";
import type { ChatMessageRow } from "../types";
const mocks = vi.hoisted(() => ({ latest: vi.fn(), known: vi.fn(), reactions: vi.fn(), map: vi.fn() }));
vi.mock("./messageSync", () => ({
  fetchLatestMessages: mocks.latest, fetchKnownMessages: mocks.known,
  fetchReactions: mocks.reactions, mapMessageRow: mocks.map, fetchOlderMessages: vi.fn(),
}));
import { loadMessageSnapshot } from "./messageSnapshot";
const options = { chatId: "chat", accountId: "user", selfName: "Me", authorName: "Peer" };
const row = (id: string, body = "old") => ({ id, body }) as ChatMessageRow;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.latest.mockResolvedValue([]);
  mocks.known.mockResolvedValue([]);
  mocks.reactions.mockResolvedValue({});
  mocks.map.mockImplementation(async (item: ChatMessageRow) => ({ id: 1, remoteId: item.id, text: item.body }));
});
it("uses the explicit lookup for edits and deletions even if the page query was stale", async () => {
  mocks.latest.mockResolvedValue([row("gone"), row("edited"), row("new")]);
  mocks.known.mockResolvedValue([row("edited", "updated")]);
  const messages = await loadMessageSnapshot(options, ["gone", "edited"]);
  expect(messages?.map(message => [message.remoteId, message.text])).toEqual([["new", "old"], ["edited", "updated"]]);
});
it("never interprets failed visibility or row lookups as a successful empty snapshot", async () => {
  mocks.known.mockResolvedValue(null);
  expect(await loadMessageSnapshot(options, ["private"])).toBeNull();
  expect(mocks.map).not.toHaveBeenCalled();
  mocks.known.mockResolvedValue([]);
  mocks.latest.mockResolvedValue(null);
  expect(await loadMessageSnapshot(options, [])).toBeNull();
});
it("keeps the current snapshot when transport or reaction loading fails", async () => {
  mocks.latest.mockRejectedValueOnce(new TypeError("offline"));
  expect(await loadMessageSnapshot(options, [])).toBeNull();
  mocks.reactions.mockRejectedValueOnce(new Error("reaction service unavailable"));
  expect(await loadMessageSnapshot(options, [])).toBeNull();
});
