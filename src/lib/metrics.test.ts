import { describe, expect, it } from "vitest";
import {
  METRIC_EVENTS,
  assertNoContent,
  healthLabel,
  healthSnapshot,
  isMetricEvent,
  isValidSample,
  summarise,
  type MetricSample,
} from "./metrics";

function sample(event: MetricSample["event"], value: number, code?: string): MetricSample {
  return { event, value, code, at: 1_700_000_000_000 };
}

describe("quality metrics", () => {
  describe("what is allowed to be measured", () => {
    it("accepts a known event with a number", () => {
      expect(isValidSample(sample("message_sent", 420))).toBe(true);
    });

    it("refuses an event that is not in the list", () => {
      expect(isMetricEvent("message_text")).toBe(false);
      expect(isValidSample({ ...sample("message_sent", 1), event: "whatever" as never })).toBe(false);
    });

    it("refuses a sentence in the code field", () => {
      // A message body passed as a code is the exact failure this rule exists to prevent.
      expect(isValidSample(sample("message_failed", 1, "Привет, как дела?"))).toBe(false);
      expect(isValidSample(sample("message_failed", 1, "Timed out after 30 s"))).toBe(false);
    });

    it("accepts a machine-shaped code", () => {
      expect(isValidSample(sample("message_failed", 1, "network_timeout"))).toBe(true);
      expect(isValidSample(sample("message_failed", 1, "offline"))).toBe(true);
    });

    it("refuses a value that is not a number", () => {
      expect(isValidSample({ ...sample("message_sent", 1), value: Number.NaN })).toBe(false);
      expect(isValidSample({ ...sample("message_sent", 1), value: "120" as never })).toBe(false);
    });

    it("throws when a sample tries to leave the device carrying content", () => {
      expect(() => assertNoContent(sample("message_sent", 100))).not.toThrow();
      expect(() => assertNoContent(sample("message_sent", 1, "текст сообщения"))).toThrow();
    });

    it("lists every event it collects, so nothing is collected by accident", () => {
      // The list is the contract: adding to it is a decision, not an implementation detail.
      expect([...METRIC_EVENTS]).toEqual([
        "message_sent",
        "message_failed",
        "message_retried",
        "realtime_reconnected",
        "history_caught_up",
        "upload_refused",
        "call_refused",
      ]);
    });
  });

  describe("summarising", () => {
    it("counts and averages per event", () => {
      const summary = summarise([
        sample("message_sent", 100),
        sample("message_sent", 300),
        sample("message_failed", 1, "offline"),
      ]);
      const sent = summary.find((entry) => entry.event === "message_sent");
      expect(sent?.count).toBe(2);
      expect(sent?.average).toBe(200);
    });

    it("counts codes separately, so a reason can be seen without reading content", () => {
      const summary = summarise([
        sample("message_failed", 1, "offline"),
        sample("message_failed", 1, "offline"),
        sample("message_failed", 1, "timeout"),
      ]);
      const failed = summary.find((entry) => entry.event === "message_failed");
      expect(failed?.codes).toEqual({ offline: 2, timeout: 1 });
    });

    it("drops samples that could carry content instead of storing them", () => {
      const summary = summarise([
        sample("message_sent", 100),
        sample("message_failed", 1, "с текстом внутри"),
      ]);
      expect(summary).toHaveLength(1);
      expect(summary[0].event).toBe("message_sent");
    });

    it("returns an empty list for no samples", () => {
      expect(summarise([])).toEqual([]);
    });
  });

  describe("the headline health number", () => {
    it("says everything is fine when nothing failed", () => {
      const snapshot = healthSnapshot([sample("message_sent", 200), sample("message_sent", 400)]);
      expect(snapshot.failureRate).toBe(0);
      expect(snapshot.score).toBe(100);
      expect(healthLabel(snapshot)).toBe("Доставка работает нормально");
    });

    it("reports failures as a share of attempts", () => {
      const snapshot = healthSnapshot([
        sample("message_sent", 100),
        sample("message_sent", 100),
        sample("message_sent", 100),
        sample("message_failed", 1, "offline"),
      ]);
      expect(snapshot.failureRate).toBeCloseTo(0.25, 5);
      expect(snapshot.score).toBeLessThan(100);
    });

    it("counts reconnects against the score", () => {
      const many = healthSnapshot(Array.from({ length: 10 }, () => sample("realtime_reconnected", 1)));
      expect(many.reconnects).toBe(10);
      expect(many.score).toBeLessThan(100);
    });

    it("never goes below zero even when everything is broken", () => {
      const snapshot = healthSnapshot([
        ...Array.from({ length: 50 }, () => sample("message_failed", 1, "offline")),
        ...Array.from({ length: 50 }, () => sample("realtime_reconnected", 1)),
      ]);
      expect(snapshot.score).toBe(0);
      expect(healthLabel(snapshot)).toBe("Сообщения чаще не доходят, чем доходят");
    });

    it("reports no data as healthy rather than broken", () => {
      // Nothing measured is not the same as everything failing.
      const snapshot = healthSnapshot([]);
      expect(snapshot.failureRate).toBe(0);
      expect(snapshot.score).toBe(100);
    });
  });
});
