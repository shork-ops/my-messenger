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
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import MessageBubble from "./MessageBubble";
import type { Message } from "../types";

function message(overrides: Partial<Message> = {}): Message {
  return { id: 1, author: "Алексей", text: "привет", time: "10:15", createdAt: 1000, mine: true, ...overrides };
}

const noop = () => {};

function renderBubble(overrides: Partial<Message> = {}, showAuthor = false) {
  return render(
    <MessageBubble
      message={message(overrides)}
      showAuthor={showAuthor}
      autoloadMedia={false}
      accountId={null}
      profileName="Алексей"
      actionsOpen={false}
      showGamePreview
      onToggleActions={noop}
      onVote={noop}
      onToggleReaction={noop}
      onReply={noop}
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
