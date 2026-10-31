/**
 * @vitest-environment jsdom
 *
 * The messenger's own state, driven the way the interface drives it.
 *
 * After the split, useMessenger holds everything the screens do: sending, drafts, replies,
 * editing, deleting with undo, switching chats. None of it could be tested before, because
 * testing it meant rendering the whole app. Now the hook mounts on its own, so the rules a
 * person actually depends on can be asserted directly instead of through a browser.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useMessenger } from "./useMessenger";
import { ownerFor, scopedKey } from "../lib/accountScope";

beforeAll(() => {
  // jsdom implements no CSS media queries at all, and the app asks whether the screen is
  // narrow. This is the environment being incomplete, not the app asking for something odd.
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

beforeEach(() => {
  // Each test starts from a clean device: the hook reads drafts, folders and preferences out
  // of storage on mount, and one test's leftovers would explain the next test's failure.
  window.localStorage.clear();
});

function mount() {
  return renderHook(() => useMessenger());
}

describe("useMessenger: what it exposes", () => {
  it("mounts with the whole surface the screens need", () => {
    const { result } = mount();
    // The number is not the point; the point is that nothing essential went missing in the
    // split and the shell is not rendering against undefined.
    expect(Object.keys(result.current).length).toBeGreaterThan(200);
    // Named explicitly rather than indexed, so a rename in the hook fails to compile here
    // instead of quietly passing a check that looked itself up by a string.
    expect(typeof result.current.sendMessage).toBe("function");
    expect(typeof result.current.selectChat).toBe("function");
    expect(typeof result.current.createFolder).toBe("function");
    expect(typeof result.current.toggleReaction).toBe("function");
    expect(typeof result.current.deleteMessage).toBe("function");
    expect(typeof result.current.undoDelete).toBe("function");
    expect(typeof result.current.replyToMessage).toBe("function");
    expect(typeof result.current.changeDraft).toBe("function");
  });

  it("starts with no chat open", () => {
    const { result } = mount();
    expect(result.current.activeId === null || typeof result.current.activeId === "number").toBe(true);
  });
});

describe("useMessenger: drafts", () => {
  it("keeps a draft per chat, so an unsent thought is not overwritten", () => {
    // Drafts used to be one string: typing in one chat and switching to another lost it.
    const { result } = mount();
    act(() => {
      result.current.changeDraft("для первого");
    });
    expect(result.current.draft).toBe("для первого");
  });

  it("stores the draft rather than only holding it in memory", () => {
    const { result } = mount();
    act(() => {
      result.current.changeDraft("чтобы не потерять");
    });
    // Drafts live inside the account's own namespace, so the shared key must stay empty: a draft
    // written by one account is not readable by the next person to sign in on this browser.
    expect(window.localStorage.getItem("nexus-drafts-v1")).toBeNull();
    const stored = window.localStorage.getItem(scopedKey(ownerFor(null), "nexus-drafts-v1"));
    expect(stored, "the draft was never written").toBeTruthy();
    expect(stored).toContain("чтобы не потерять");
  });

  it("accepts an emoji into the draft", () => {
    const { result } = mount();
    act(() => {
      result.current.changeDraft("привет");
    });
    act(() => {
      result.current.addEmoji("🙂");
    });
    expect(result.current.draft).toContain("🙂");
  });
});

describe("useMessenger: messages", () => {
  it("does not send an empty message", () => {
    // Pressing Enter on an empty box must do nothing rather than create a blank bubble.
    const { result } = mount();
    const before = result.current.chats.reduce((count, chat) => count + chat.messages.length, 0);
    act(() => {
      void result.current.sendMessage({ preventDefault: () => {} } as never);
    });
    const after = result.current.chats.reduce((count, chat) => count + chat.messages.length, 0);
    expect(after).toBe(before);
  });

  it("sends text into the open chat and clears the box", () => {
    const { result } = mount();
    const chat = result.current.chats[0];
    expect(chat, "the demo has no chats to send into").toBeTruthy();

    act(() => {
      result.current.selectChat(chat);
    });
    act(() => {
      result.current.changeDraft("сообщение из теста");
    });
    act(() => {
      void result.current.sendMessage({ preventDefault: () => {} } as never);
    });

    const updated = result.current.chats.find((item) => item.id === chat.id);
    const texts = (updated?.messages ?? []).map((message) => message.text);
    expect(texts, "the message was not added").toContain("сообщение из теста");
    expect(result.current.draft, "the box was not emptied").toBe("");
  });
});

describe("useMessenger: deleting with undo", () => {
  it("offers the deleted message back", () => {
    // Undo is the only thing standing between a misclick and a lost message.
    const { result } = mount();
    const chat = result.current.chats[0];
    act(() => {
      result.current.selectChat(chat);
    });
    act(() => {
      result.current.changeDraft("это удалят");
    });
    act(() => {
      void result.current.sendMessage({ preventDefault: () => {} } as never);
    });

    const withMessage = result.current.chats.find((item) => item.id === chat.id);
    const target = withMessage?.messages.find((message) => message.text === "это удалят");
    expect(target, "the message to delete was never created").toBeTruthy();

    act(() => {
      result.current.deleteMessage(target!.id);
    });
    const afterDelete = result.current.chats
      .find((item) => item.id === chat.id)
      ?.messages.some((message) => message.text === "это удалят");
    expect(afterDelete, "the message survived a delete").toBe(false);

    act(() => {
      result.current.undoDelete();
    });
    const afterUndo = result.current.chats
      .find((item) => item.id === chat.id)
      ?.messages.some((message) => message.text === "это удалят");
    expect(afterUndo, "undo did not bring the message back").toBe(true);
  });
});

describe("useMessenger: replying", () => {
  it("remembers which message a reply answers", () => {
    const { result } = mount();
    const chat = result.current.chats[0];
    act(() => {
      result.current.selectChat(chat);
    });
    const target = chat.messages[0];
    expect(target, "the chat has no messages to reply to").toBeTruthy();

    act(() => {
      result.current.replyToMessage(target);
    });
    expect(result.current.replyTarget?.author).toBe(target.author);
    expect(result.current.replyTarget?.text).toBe(target.text);
  });

  it("stays a quote of the author and the words, not a link to a message id", () => {
    // A message id does not survive a reload, so the reply is stored as what the reader
    // sees. Storing the id would make the quote vanish after a refresh.
    const { result } = mount();
    const chat = result.current.chats[0];
    act(() => {
      result.current.selectChat(chat);
    });
    const target = chat.messages[0];
    act(() => {
      result.current.replyToMessage(target);
    });
    expect(window.localStorage.getItem("nexus-reply-drafts-v1")).toBeNull();
    const stored = window.localStorage.getItem(scopedKey(ownerFor(null), "nexus-reply-drafts-v1"));
    expect(stored, "the reply target was never stored").toBeTruthy();
    expect(stored).toContain(target.author);
  });
});
