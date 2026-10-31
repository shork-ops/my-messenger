import { describe, expect, it } from "vitest";
import {
  MAX_CATCH_UP_ATTEMPTS,
  catchUpAfter,
  catchUpLabel,
  channelStatus,
  isRecovery,
  mergeCatchUp,
  shouldRetryCatchUp,
} from "./catchUp";

type Row = { id: number; remoteId?: string | null; text: string };

const row = (id: number, text = `m${id}`, remoteId = `r${id}`): Row => ({ id, text, remoteId });

describe("catching up after a lost connection", () => {
  describe("reading the channel status", () => {
    it("treats only SUBSCRIBED as working", () => {
      expect(channelStatus("SUBSCRIBED")).toBe("joined");
    });

    it("treats every way of being disconnected as lost", () => {
      // All three are recoverable, which is why the reason is kept rather than a boolean.
      expect(channelStatus("CHANNEL_ERROR")).toBe("lost");
      expect(channelStatus("TIMED_OUT")).toBe("lost");
      expect(channelStatus("CLOSED")).toBe("lost");
    });

    it("does not invent a meaning for a status it does not know", () => {
      expect(channelStatus("JOINING")).toBe("other");
      expect(channelStatus(undefined)).toBe("other");
    });
  });

  describe("knowing when a join is a recovery", () => {
    it("does not treat the first join as a recovery", () => {
      // The conversation was just loaded; fetching it again would fill no gap.
      expect(isRecovery(null, "joined")).toBe(false);
    });

    it("treats a join after a loss as a recovery", () => {
      expect(isRecovery("lost", "joined")).toBe(true);
    });

    it("does not treat joining twice in a row as another recovery", () => {
      expect(isRecovery("joined", "joined")).toBe(false);
    });

    it("does not treat going to lost as a recovery", () => {
      expect(isRecovery("joined", "lost")).toBe(false);
    });
  });

  describe("merging what was fetched into what is on screen", () => {
    it("does not show a message twice when both sides have it", () => {
      const merged = mergeCatchUp([row(1), row(2)], [row(1), row(2)]);
      expect(merged.map((item) => item.id)).toEqual([1, 2]);
    });

    it("prefers the fetched copy, because it carries edits and reactions from the gap", () => {
      const onScreen = [row(1, "старый текст")];
      const fetched = [row(1, "новый текст")];
      expect(mergeCatchUp(onScreen, fetched)[0].text).toBe("новый текст");
    });

    it("keeps messages that arrived from the socket while the fetch was in flight", () => {
      // Replacing the list with the server's copy would recreate the gap this is meant to close.
      const onScreen = [row(1), row(3)];
      const fetched = [row(1), row(2)];
      const merged = mergeCatchUp(onScreen, fetched);
      expect(merged.map((item) => item.id)).toEqual([1, 2, 3]);
    });

    it("orders by id so the merge is stable whichever side a message came from", () => {
      const merged = mergeCatchUp([row(5), row(2)], [row(3), row(4)]);
      expect(merged.map((item) => item.id)).toEqual([2, 3, 4, 5]);
    });

    it("tells apart a local message and a remote one that happen to share a number", () => {
      const local: Row = { id: 1, remoteId: null, text: "локальное" };
      const remote: Row = { id: 1, remoteId: "r1", text: "облачное" };
      expect(mergeCatchUp([local], [remote])).toHaveLength(2);
    });

    it("does not lose an on-screen message when nothing was fetched", () => {
      expect(mergeCatchUp([row(1), row(2)], []).map((item) => item.id)).toEqual([1, 2]);
    });

    it("returns the fetched messages when nothing was on screen", () => {
      expect(mergeCatchUp([], [row(1), row(2)]).map((item) => item.id)).toEqual([1, 2]);
    });
  });

  describe("how much to fetch", () => {
    it("anchors the fetch on the last message seen", () => {
      expect(catchUpAfter(4200)).toBe(4200);
    });

    it("asks for the usual page when there is nothing to anchor to", () => {
      expect(catchUpAfter(null)).toBeNull();
      expect(catchUpAfter(Number.NaN)).toBeNull();
    });

    it("stops retrying a failing catch-up instead of looping", () => {
      expect(shouldRetryCatchUp(0)).toBe(true);
      expect(shouldRetryCatchUp(MAX_CATCH_UP_ATTEMPTS - 1)).toBe(true);
      expect(shouldRetryCatchUp(MAX_CATCH_UP_ATTEMPTS)).toBe(false);
    });
  });

  describe("what the person is told", () => {
    it("says nothing when nothing is happening", () => {
      expect(catchUpLabel("idle")).toBeNull();
    });

    it("says it is filling the gap", () => {
      expect(catchUpLabel("catching")).toContain("Догоняю");
    });

    it("admits it when the catch-up failed rather than pretending", () => {
      // "часть сообщений" is feminine, so the agreement is "могла".
      expect(catchUpLabel("failed")).toContain("могла не загрузиться");
    });
  });
});
