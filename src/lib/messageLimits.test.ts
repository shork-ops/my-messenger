import { expect, it } from "vitest";
import { exceedsMessageLimit } from "./messageLimits";
it("uses the database's Unicode character count", () => {
  expect(exceedsMessageLimit("🙂".repeat(10_000))).toBe(false);
  expect(exceedsMessageLimit("🙂".repeat(10_001))).toBe(true);
});
