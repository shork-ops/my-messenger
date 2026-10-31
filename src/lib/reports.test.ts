import { describe, expect, it } from "vitest";
import {
  REPORT_DETAILS_LIMIT,
  REPORT_DUPLICATE,
  REPORT_REASONS,
  clampDetails,
  canReportAgain,
  isReportable,
  isReportReason,
  reportError,
  reportPrompt,
  statusLabel,
} from "./reports";

describe("reporting a message or a conversation", () => {
  describe("when a report can be offered at all", () => {
    it("offers it for a message that came from the server", () => {
      expect(isReportable({ chatId: "chat-1", messageId: "msg-1" })).toBe(true);
    });

    it("offers it for a whole conversation", () => {
      expect(isReportable({ chatId: "chat-1", messageId: null })).toBe(true);
    });

    it("refuses a conversation that only exists on this device", () => {
      // There is nothing on the server to attach the complaint to, so the button would lie.
      expect(isReportable({ chatId: "", messageId: null })).toBe(false);
      expect(isReportable(null)).toBe(false);
    });

    it("refuses a message that has not been sent yet", () => {
      expect(isReportable({ chatId: "chat-1", messageId: "" })).toBe(false);
    });
  });

  describe("reasons", () => {
    it("offers exactly the reasons the database accepts", () => {
      // A reason the interface offers and the column rejects is a bug the person discovers
      // by pressing it.
      expect(REPORT_REASONS.map((reason) => reason.id)).toEqual(["spam", "abuse", "illegal", "other"]);
    });

    it("recognises a real reason and refuses an invented one", () => {
      expect(isReportReason("abuse")).toBe(true);
      expect(isReportReason("мне просто не нравится")).toBe(false);
    });

    it("asks a different question depending on what is being reported", () => {
      expect(reportPrompt("message")).toContain("сообщением");
      expect(reportPrompt("chat")).toContain("разговором");
    });
  });

  describe("the explanation a person writes", () => {
    it("trims it and keeps a normal one whole", () => {
      expect(clampDetails("  он писал мне первым  ")).toEqual({ text: "он писал мне первым", truncated: false });
    });

    it("turns an empty explanation into nothing rather than an empty string", () => {
      expect(clampDetails("   ")).toEqual({ text: null, truncated: false });
    });

    it("cuts a too-long explanation and says so instead of losing the end silently", () => {
      const long = "а".repeat(REPORT_DETAILS_LIMIT + 50);
      const result = clampDetails(long);
      expect(result.text).toHaveLength(REPORT_DETAILS_LIMIT);
      // The person has to be told their text was cut, or they believe it was all sent.
      expect(result.truncated).toBe(true);
    });

    it("keeps one character under the limit intact", () => {
      const exact = "а".repeat(REPORT_DETAILS_LIMIT);
      expect(clampDetails(exact).truncated).toBe(false);
    });
  });

  describe("what a person is told", () => {
    it("promises nothing the code cannot do", () => {
      // "Мы заблокируем" would be a promise this code cannot keep.
      expect(REPORT_DUPLICATE).toContain("уже жаловались");
    });

    it("turns each server refusal into something actionable", () => {
      expect(reportError("not_a_member")).toContain("больше не участник");
      expect(reportError("message_not_found")).toContain("удалено");
      expect(reportError("not_authenticated")).toContain("войти");
      expect(reportError("no_subject")).toContain("не выбран");
    });

    it("has a plain answer for an unexpected failure", () => {
      expect(reportError("что-то новое")).toContain("Попробуйте ещё раз");
      expect(reportError(undefined)).toContain("Попробуйте ещё раз");
    });
  });

  describe("the state of a person's own reports", () => {
    it("names each state in words a person understands", () => {
      expect(statusLabel("open")).toBe("Ждёт рассмотрения");
      expect(statusLabel("actioned")).toBe("Приняты меры");
    });

    it("does not let the same complaint be filed twice while it is pending", () => {
      expect(canReportAgain({ status: "open" })).toBe(false);
    });

    it("allows a new complaint once the previous one was resolved", () => {
      // Something new can happen after a complaint was dismissed.
      expect(canReportAgain({ status: "dismissed" })).toBe(true);
    });

    it("allows a complaint when nothing was reported before", () => {
      expect(canReportAgain(null)).toBe(true);
      expect(canReportAgain(undefined)).toBe(true);
    });
  });
});
