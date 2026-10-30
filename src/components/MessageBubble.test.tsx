/**
 * @vitest-environment jsdom
 *
 * The gap this closes is between the logic tests and the end-to-end tests: both pass while
 * a bubble renders unreadably, because neither looks at the class names a component chooses.
 * The H1 audit found the own-message time at 1.61:1 on a light theme - invisible in
 * practice, and invisible to every test that existed.
 *
 * Nothing here measures pixels: jsdom does not compute cascade colours for custom
 * properties. What is checked is the decision the component makes - which theme class the
 * time carries - because that decision is exactly what was wrong.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { VIEW_ONCE_SECONDS } from "../lib/viewOnce";
import { EFFECTS } from "../lib/effects";
import MessageBubble from "./MessageBubble";
import type { Message } from "../types";

function message(overrides: Partial<Message> = {}): Message {
  return { id: 1, author: "Алексей", text: "привет", time: "10:15", createdAt: 1000, mine: true, ...overrides };
}

const noop = () => {};

function renderBubble(
  overrides: Partial<Message> = {},
  showAuthor = false,
  runs: { continuesRun?: boolean; endsRun?: boolean; actionsOpen?: boolean; onReply?: () => void } = {}
) {
  return render(
    <MessageBubble
      message={message(overrides)}
      showAuthor={showAuthor}
      groupContext={showAuthor}
      continuesRun={runs.continuesRun ?? false}
      endsRun={runs.endsRun ?? true}
      autoloadMedia={false}
      accountId={null}
      profileName="Алексей"
      actionsOpen={runs.actionsOpen ?? false}
      showGamePreview
      onToggleActions={noop}
      onVote={noop}
      onToggleReaction={noop}
      onReply={runs.onReply ?? noop}
      onCopy={noop}
      onForward={noop}
      onFavourite={noop}
      onTogglePin={noop}
      pinned={false}
      onEffect={noop}
      onEdit={noop}
      onDeleteLocal={noop}
      onDelete={noop}
      onGameInvite={noop}
    />
  );
}

afterEach(cleanup);

describe("MessageBubble", () => {
  it("replies to a horizontal swipe but leaves vertical scrolling alone", () => {
    const reply = vi.fn();
    const { container } = renderBubble({}, false, { onReply: reply });
    const row = container.querySelector(".message-line")!;
    fireEvent.touchStart(row, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchEnd(row, { changedTouches: [{ clientX: 110, clientY: 240 }] });
    expect(reply).not.toHaveBeenCalled();
    fireEvent.touchStart(row, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchEnd(row, { changedTouches: [{ clientX: 180, clientY: 105 }] });
    expect(reply).toHaveBeenCalledOnce();
  });
  it("shows the text and the time", () => {
    const { container } = renderBubble({ text: "проверка" });
    expect(container.textContent).toContain("проверка");
    expect(container.textContent).toContain("10:15");
  });

  it("marks its own messages so the stylesheet can treat them differently", () => {
    const { container } = renderBubble({ mine: true });
    expect(container.querySelector(".message-line.mine")).not.toBeNull();
  });

  it("does not mark the other side's messages as its own", () => {
    const { container } = renderBubble({ mine: false, author: "Аня" });
    expect(container.querySelector(".message-line.mine")).toBeNull();
  });

  it("gives its own message time the class the themes fix the colour with", () => {
    // In the light theme an own bubble is a bright yellow, so a muted grey time sat at
    // 1.61:1 on it. The override lives on `.mine-bubble .message-time`.
    const { container } = renderBubble({ mine: true });
    const bubble = container.querySelector(".mine-bubble");
    expect(bubble, "an own message has no .mine-bubble").not.toBeNull();
    expect(bubble?.querySelector(".message-time")).not.toBeNull();
  });

  it("does not use the own-bubble class on the other side's messages", () => {
    // The override would otherwise repaint the other side's time for no reason.
    const { container } = renderBubble({ mine: false });
    expect(container.querySelector(".mine-bubble")).toBeNull();
  });

  it("marks an edited message as edited", () => {
    const { container } = renderBubble({ edited: true } as Partial<Message>);
    expect(container.textContent).toContain("изменено");
  });

  it("renders a reply with the quoted original", () => {
    const { container } = renderBubble({ replyTo: { author: "Аня", text: "исходное" } } as Partial<Message>);
    expect(container.textContent).toContain("исходное");
  });

  it("renders a poll question and its options", () => {
    const { container } = renderBubble({
      text: "",
      poll: { question: "Выбор?", options: [{ id: "1", text: "первый", votes: [] }] },
    } as Partial<Message>);
    expect(container.textContent).toContain("Выбор?");
    expect(container.textContent).toContain("первый");
  });

  it("renders markup in the text as text, not as markup", () => {
    const { container } = renderBubble({ text: "<b>не жирный</b>" });
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("<b>не жирный</b>");
  });
});


describe("who spoke is named only where it is needed", () => {
  it("keeps the name and face off a one-to-one chat", () => {
    // There is one other person in the conversation; the header already says who it is.
    const { container } = renderBubble({ author: "Аня", mine: false }, false);
    expect(container.querySelector(".message-author")).toBeNull();
    expect(container.querySelector(".avatar")).toBeNull();
  });

  it("names the speaker in a group, where names are how you tell who spoke", () => {
    const { container } = renderBubble({ author: "Аня", mine: false }, true);
    expect(container.querySelector(".message-author")?.textContent).toBe("Аня");
    expect(container.querySelector(".avatar")).not.toBeNull();
  });

  it("does not name the reader to themselves even in a group", () => {
    const { container } = renderBubble({ author: "Алексей", mine: true }, true);
    expect(container.querySelector(".message-author")).toBeNull();
  });
});

describe("an effect belongs to whoever wrote the message", () => {
  it("offers the effect stickers on the reader's own message", () => {
    const { container } = renderBubble({ mine: true }, false, { actionsOpen: true });
    expect(container.querySelector('[aria-label="Эффекты"]')).not.toBeNull();
    // The count comes from the effect list, so adding an effect does not require editing a
    // test that is only interested in whether the menu is there.
    expect(container.querySelectorAll(".effect-action")).toHaveLength(EFFECTS.length);
  });

  it("keeps the effect stickers out of the menu on someone else's message", () => {
    // Showing them invited a choice the server refused, and the refusal was silent.
    const { container } = renderBubble({ mine: false }, false, { actionsOpen: true });
    expect(container.querySelector('[aria-label="Эффекты"]')).toBeNull();
    expect(container.querySelectorAll(".effect-action")).toHaveLength(0);
  });

  it("still shows an effect that is already on someone else's message", () => {
    // The decoration is part of the message and is meant to be seen by both sides; it is
    // only the controls that belong to the author.
    const { container } = renderBubble({ mine: false, effect: "hearts" }, false, { actionsOpen: true });
    expect(container.querySelector(".message-effect-mark")).not.toBeNull();
    expect(container.querySelector('[aria-label="Эффекты"]')).toBeNull();
  });
});

describe("a photo that may be opened once", () => {
  const photo = {
    name: "фото.jpg",
    type: "image/jpeg",
    data: "data:image/jpeg;base64,AAAA",
    size: 2048,
    viewOnce: true,
  };

  it("does not paint the photo until it is opened", () => {
    // The whole point: the bytes must not be in the document before the decision to look.
    const { container } = renderBubble({ attachment: photo });
    expect(container.querySelector(".attachment-image")).toBeNull();
    expect(container.querySelector(".view-once-warning")?.textContent).toContain(
      String(VIEW_ONCE_SECONDS)
    );
  });

  it("paints it once opened, with a countdown the reader can see", () => {
    const { container } = renderBubble({ attachment: photo });
    fireEvent.click(container.querySelector(".view-once-open") as HTMLElement);
    expect(container.querySelector(".attachment-image")).not.toBeNull();
    expect(container.querySelector(".view-once-countdown")?.textContent).toContain(
      String(VIEW_ONCE_SECONDS)
    );
  });

  it("withdraws it when the countdown runs out, and does not bring it back", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderBubble({ attachment: photo });
      fireEvent.click(container.querySelector(".view-once-open") as HTMLElement);
      expect(container.querySelector(".attachment-image")).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime((VIEW_ONCE_SECONDS + 1) * 1000);
      });

      expect(container.querySelector(".attachment-image")).toBeNull();
      expect(container.querySelector(".view-once-spent")?.textContent).toContain("больше нельзя");
      // Nothing offers to open it again.
      expect(container.querySelector(".view-once-open")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves an ordinary photo alone", () => {
    const { container } = renderBubble({ attachment: { ...photo, viewOnce: false } });
    expect(container.querySelector(".view-once-card")).toBeNull();
  });

  it("draws an album picture separately - a single-view photo is never one of many", () => {
    // Marking one picture of an album would be a promise the grid cannot keep: the whole album
    // is sent at once and the other pictures stay.
    const { container } = renderBubble({ attachment: photo });
    expect(container.querySelector(".album-grid")).toBeNull();
  });
});
