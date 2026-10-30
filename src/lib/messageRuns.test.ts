/**
 * Grouping consecutive messages is the whole feature: the component only paints what this
 * decides. So the cases that matter are the boundaries - when a run starts - rather than
 * the markup that follows.
 */
import { describe, expect, it } from "vitest";
import { messageRuns, RUN_GAP_MS } from "./messageRuns";
import type { Message } from "../types";

const t0 = new Date(2026, 9, 30, 10, 0, 0).getTime();

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    author: "Максим",
    text: "привет",
    time: "10:00",
    createdAt: t0,
    ...overrides,
  };
}

/** A run of messages from one author, one minute apart. */
function from(author: string, count: number, startAt = t0): Message[] {
  return Array.from({ length: count }, (_, index) =>
    message({
      id: startAt + index,
      author,
      createdAt: startAt + index * 60_000,
      mine: false,
    })
  );
}

describe("messageRuns", () => {
  it("names the speaker once for a series from one person", () => {
    const { startsRun, continues } = messageRuns(from("Максим", 4));
    // Only the first line carries the name; the rest are recognised as the same voice.
    expect(startsRun).toEqual([true, false, false, false]);
    expect(continues).toEqual([false, true, true, true]);
  });

  it("starts a new run when someone else speaks", () => {
    const messages = [...from("Максим", 2), ...from("Аня", 2, t0 + 10 * 60_000)];
    const { startsRun } = messageRuns(messages);
    expect(startsRun).toEqual([true, false, true, false]);
  });

  it("starts a new run when the same person returns after someone else", () => {
    const messages = [
      ...from("Максим", 1),
      ...from("Аня", 1, t0 + 60_000),
      ...from("Максим", 1, t0 + 120_000),
    ];
    expect(messageRuns(messages).startsRun).toEqual([true, true, true]);
  });

  it("breaks the run after a pause long enough to be a new thought", () => {
    const messages = [
      ...from("Максим", 2),
      ...from("Максим", 1, t0 + 2 * 60_000 + RUN_GAP_MS + 1),
    ];
    const { startsRun } = messageRuns(messages);
    // Without this a conversation that paused for an hour would look like one breath, and
    // the name would sit far from the messages it labels.
    expect(startsRun).toEqual([true, false, true]);
  });

  it("keeps the run together just under the pause", () => {
    const messages = [...from("Максим", 2), ...from("Максим", 1, t0 + 60_000 + RUN_GAP_MS)];
    expect(messageRuns(messages).startsRun).toEqual([true, false, false]);
  });

  it("starts a new run on a new day", () => {
    const tomorrow = new Date(2026, 9, 31, 10, 0, 0).getTime();
    const messages = [...from("Максим", 2), ...from("Максим", 1, tomorrow)];
    expect(messageRuns(messages).startsRun).toEqual([true, false, true]);
  });

  it("treats the reader's own messages as their own voice", () => {
    const messages = [
      message({ id: 1, mine: true, author: "Я", createdAt: t0 }),
      message({ id: 2, mine: true, author: "Я", createdAt: t0 + 60_000 }),
      message({ id: 3, mine: false, author: "Максим", createdAt: t0 + 120_000 }),
    ];
    expect(messageRuns(messages).startsRun).toEqual([true, false, true]);
  });

  it("never merges the reader's messages with someone else's", () => {
    // Both are called "Я" in some data; ownership, not the label, decides.
    const messages = [
      message({ id: 1, mine: true, author: "Я", createdAt: t0 }),
      message({ id: 2, mine: false, author: "Я", createdAt: t0 + 60_000 }),
    ];
    expect(messageRuns(messages).startsRun).toEqual([true, true]);
  });

  it("marks the last message of a run so its tail can be rounded", () => {
    const { endsRun } = messageRuns(from("Максим", 3));
    expect(endsRun).toEqual([false, false, true]);
  });

  it("without timestamps falls back to the author alone", () => {
    const messages = [
      message({ id: 1, createdAt: undefined }),
      message({ id: 2, createdAt: undefined }),
    ];
    expect(messageRuns(messages).startsRun).toEqual([true, false]);
  });

  it("handles an empty conversation", () => {
    expect(messageRuns([])).toEqual({ startsRun: [], endsRun: [], continues: [] });
  });
});
