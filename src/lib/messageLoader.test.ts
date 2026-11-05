import { beforeEach, expect, it, vi } from "vitest";
import type { ChatMessageRow } from "../types";
const mocks = vi.hoisted(() => ({ latest: vi.fn(), known: vi.fn(), reactions: vi.fn(), map: vi.fn(), recovery: vi.fn() }));
vi.mock("./messageSync", () => ({
  fetchLatestMessages: mocks.latest, fetchKnownMessages: mocks.known,
  fetchReactions: mocks.reactions, mapMessageRow: mocks.map, fetchOlderMessages: vi.fn(),
}));
vi.mock("./messageRecovery", () => ({ fetchRecoveryMessages: mocks.recovery }));
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
  mocks.latest.mockResolvedValue([row("message")]);
  mocks.reactions.mockRejectedValueOnce(new Error("reaction service unavailable"));
  expect(await loadMessageSnapshot(options, [])).toBeNull();
});

it("uses paginated recovery for an existing history window and batches reactions", async () => {
  mocks.recovery.mockResolvedValue(Array.from({length:251},(_,i)=>row(String(i))));
  const messages=await loadMessageSnapshot(options,[],123);
  expect(messages).toHaveLength(251);
  expect(mocks.recovery).toHaveBeenCalledWith("chat",123);
  expect(mocks.latest).not.toHaveBeenCalled();
  expect(mocks.reactions).toHaveBeenCalledTimes(6);
  expect(Math.max(...mocks.reactions.mock.calls.map(args=>args[0].length))).toBe(50);
});
