import { describe, expect, it } from "vitest";
import { clockTime, dateLabel, formatClock, numericId } from "./format";

describe("numericId", () => {
  it("derives a stable number from a uuid", () => {
    const id = "0dd3aec3-3042-4e94-8576-93b27cb8a352";
    expect(numericId(id)).toBe(numericId(id));
    expect(Number.isFinite(numericId(id))).toBe(true);
    expect(numericId(id)).toBe(parseInt("0dd3aec33042", 16));
  });
});

describe("time formatting", () => {
  it("formats hours and minutes with two digits", () => {
    const value = new Date(2026, 9, 28, 9, 5);
    expect(formatClock(value)).toMatch(/^09:05$/);
    expect(clockTime(value)).toBe("09:05");
  });
});

describe("dateLabel", () => {
  const now = new Date(2026, 9, 28, 12, 0);

  it("labels today and yesterday", () => {
    expect(dateLabel(new Date(2026, 9, 28, 8, 0).getTime(), now)).toBe("Сегодня");
    expect(dateLabel(new Date(2026, 9, 27, 23, 0).getTime(), now)).toBe("Вчера");
  });

  it("formats older dates with a month name", () => {
    const label = dateLabel(new Date(2026, 8, 15, 10, 0).getTime(), now);
    expect(label).toMatch(/15/);
    expect(label.toLowerCase()).toMatch(/сентябр/);
  });

  it("adds the year for dates from another year", () => {
    const label = dateLabel(new Date(2025, 11, 31, 10, 0).getTime(), now);
    expect(label).toMatch(/2025/);
  });
});
