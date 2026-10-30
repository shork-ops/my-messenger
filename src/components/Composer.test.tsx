/** @vitest-environment jsdom */
/**
 * Every control must have an accessible name.
 *
 * A file input is hidden and opened by a button next to it, so nothing on screen shows that
 * it has no name - not to a person looking at it, and not to a reviewer. A screen reader
 * announces "button" and stops. The composer's attachment input was exactly that.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, type ComponentProps } from "react";
import Composer from "./Composer";

beforeEach(() => {
  // jsdom has no matchMedia, and the composer reads it for the narrow layout.
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const noop = () => {};

const renderComposer = (overrides: Partial<ComponentProps<typeof Composer>> = {}) =>
  render(
    <Composer
      draft=""
      editDraft=""
      editing={false}
      replyTarget={null}
      mentionOpen={false}
      mentionMatches={[]}
      recording={false}
      recordingSeconds={0}
      fileInputRef={createRef<HTMLInputElement>()}
      onChangeText={noop}
      onEmoji={noop}
      onSchedule={noop}
      onViewOnce={noop}
      onStickers={noop}
      onVideoNote={noop}
      onToggleVoice={noop}
      onSubmit={noop}
      onCancelEdit={noop}
      onCancelReply={noop}
      onChooseMention={noop}
      onAttachment={noop}
      onOpenGallery={noop}
      onOpenPoll={noop}
      {...overrides}
    />
  );

describe("composer controls", () => {
  it("keeps Return for a new line on a phone", () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    const { container } = renderComposer({ draft: "Привет" });
    const submit = vi.spyOn(container.querySelector("form")!, "requestSubmit").mockImplementation(noop);
    fireEvent.keyDown(screen.getByLabelText("Текст сообщения"), { key: "Enter" });
    expect(submit).not.toHaveBeenCalled();
  });
  it("sends on Enter but preserves Shift+Enter and IME confirmation", () => {
    const { container } = renderComposer({ draft: "Привет" });
    const submit = vi.spyOn(container.querySelector("form")!, "requestSubmit").mockImplementation(noop);
    const field = screen.getByLabelText("Текст сообщения");
    fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(field, { key: "Enter", isComposing: true });
    fireEvent.keyDown(field, { key: "Enter", keyCode: 229 });
    expect(submit).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(submit).toHaveBeenCalledOnce();
  });

  it("does not submit whitespace with Enter", () => {
    const { container } = renderComposer({ draft: " \n " });
    const submit = vi.spyOn(container.querySelector("form")!, "requestSubmit").mockImplementation(noop);
    fireEvent.keyDown(screen.getByLabelText("Текст сообщения"), { key: "Enter" });
    expect(submit).not.toHaveBeenCalled();
  });

  it("gives the hidden file input a name, because nothing on screen shows it lacks one", () => {
    const { container } = renderComposer();
    const input = container.querySelector('input[type="file"]');
    expect(input, "the attachment input is gone").not.toBeNull();
    expect(input?.getAttribute("aria-label")).toBe("Прикрепить файл");
  });

  it("names the message field, so a screen reader says what it is for", () => {
    renderComposer();
    expect(screen.getByLabelText("Текст сообщения")).toBeTruthy();
  });

  it("names every button it renders", () => {
    const { container } = renderComposer();
    const unnamed = [...container.querySelectorAll("button")]
      .filter((button) => !button.textContent?.trim() && !button.getAttribute("aria-label"))
      .map((button) => button.className);
    expect(unnamed).toEqual([]);
  });
});
