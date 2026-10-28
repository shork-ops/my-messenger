import { describe, expect, it } from "vitest";
import type { Poll } from "../types";
import { hasUserVoted, pollPercent, pollTotal, toggleLocalVote } from "./polls";

function poll(): Poll {
  return {
    question: "Куда идём?",
    options: [
      { id: "a", text: "Кофе", votes: [] },
      { id: "b", text: "Кино", votes: [] },
    ],
  };
}

describe("pollTotal", () => {
  it("sums votes across options", () => {
    const value: Poll = { question: "q", options: [{ id: "a", text: "A", votes: ["u1", "u2"] }, { id: "b", text: "B", votes: ["u3"] }] };
    expect(pollTotal(value)).toBe(3);
    expect(pollTotal(poll())).toBe(0);
  });
});

describe("pollPercent", () => {
  it("rounds to whole percents and guards zero totals", () => {
    expect(pollPercent(1, 3)).toBe(33);
    expect(pollPercent(2, 3)).toBe(67);
    expect(pollPercent(0, 0)).toBe(0);
  });
});

describe("hasUserVoted", () => {
  it("detects the user in any option", () => {
    const value: Poll = { question: "q", options: [{ id: "a", text: "A", votes: ["u1"] }, { id: "b", text: "B", votes: [] }] };
    expect(hasUserVoted(value, "u1")).toBe(true);
    expect(hasUserVoted(value, "u2")).toBe(false);
  });
});

describe("toggleLocalVote", () => {
  it("adds a vote", () => {
    const next = toggleLocalVote(poll(), "a", "u1");
    expect(next.options[0].votes).toEqual(["u1"]);
    expect(next.options[1].votes).toEqual([]);
  });

  it("moves the vote to another option", () => {
    const first = toggleLocalVote(poll(), "a", "u1");
    const second = toggleLocalVote(first, "b", "u1");
    expect(second.options[0].votes).toEqual([]);
    expect(second.options[1].votes).toEqual(["u1"]);
  });

  it("removes the vote when the same option is clicked again", () => {
    const first = toggleLocalVote(poll(), "a", "u1");
    const second = toggleLocalVote(first, "a", "u1");
    expect(second.options[0].votes).toEqual([]);
    expect(second.options[1].votes).toEqual([]);
  });

  it("keeps other users' votes untouched", () => {
    const value: Poll = { question: "q", options: [{ id: "a", text: "A", votes: ["u2"] }, { id: "b", text: "B", votes: [] }] };
    const next = toggleLocalVote(value, "b", "u1");
    expect(next.options[0].votes).toEqual(["u2"]);
    expect(next.options[1].votes).toEqual(["u1"]);
  });

  it("does not mutate the source poll", () => {
    const value = poll();
    toggleLocalVote(value, "a", "u1");
    expect(value.options[0].votes).toEqual([]);
  });
});
