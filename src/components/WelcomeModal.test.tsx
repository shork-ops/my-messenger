/**
 * The first-run card.
 *
 * What matters is who gets it and what each button does: only a signed-in account with no
 * username sees it, once; "Позже" and an empty username close it without asking the server;
 * a username is checked before it is sent, and a refusal from the server keeps the card open.
 */

/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import WelcomeModal, { usernameProblem } from "./WelcomeModal";
import { useWelcome, welcomeKey } from "../hooks/useWelcome";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderCard(username: string, saveResult = true) {
  const onSaveUsername = vi.fn(async () => saveResult);
  const onFinish = vi.fn();
  const view = render(
    <WelcomeModal
      name="Валя"
      username={username}
      photoUrl={null}
      uploading={false}
      saving={false}
      onNameChange={() => undefined}
      onUsernameChange={() => undefined}
      onPhoto={() => undefined}
      onSaveUsername={onSaveUsername}
      onFinish={onFinish}
    />,
  );
  const button = (text: string) => Array.from(view.container.querySelectorAll("button")).find((item) => item.textContent?.trim() === text)!;
  return { ...view, onSaveUsername, onFinish, button };
}

describe("the first-run card", () => {
  it("closes on «Позже» without saving anything", () => {
    const card = renderCard("valya");
    fireEvent.click(card.button("Позже"));
    expect(card.onFinish).toHaveBeenCalledTimes(1);
    expect(card.onSaveUsername).not.toHaveBeenCalled();
  });

  it("closes on Escape the same way", () => {
    const card = renderCard("");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(card.onFinish).toHaveBeenCalledTimes(1);
  });

  it("finishes without the server when no username was typed", async () => {
    const card = renderCard("");
    fireEvent.click(card.button("Готово"));
    await waitFor(() => expect(card.onFinish).toHaveBeenCalledTimes(1));
    expect(card.onSaveUsername).not.toHaveBeenCalled();
  });

  it("explains a username that cannot be saved instead of sending it", async () => {
    const card = renderCard("va");
    expect(card.container.textContent).not.toContain("Минимум 3 символа");
    fireEvent.click(card.button("Готово"));
    await waitFor(() => expect(card.container.querySelector("[role=alert]")?.textContent).toBe("Минимум 3 символа"));
    expect(card.onSaveUsername).not.toHaveBeenCalled();
    expect(card.onFinish).not.toHaveBeenCalled();
  });

  it("saves the username, then closes", async () => {
    const card = renderCard("valya_2026");
    fireEvent.click(card.button("Готово"));
    await waitFor(() => expect(card.onFinish).toHaveBeenCalledTimes(1));
    expect(card.onSaveUsername).toHaveBeenCalledTimes(1);
  });

  it("stays open when the server refuses the username", async () => {
    const card = renderCard("taken_name", false);
    fireEvent.click(card.button("Готово"));
    await waitFor(() => expect(card.onSaveUsername).toHaveBeenCalledTimes(1));
    expect(card.onFinish).not.toHaveBeenCalled();
  });

  it("names the problem with a username as it is typed", () => {
    expect(usernameProblem("")).toBeNull();
    expect(usernameProblem("valya")).toBeNull();
    expect(usernameProblem("Valya")).toBeNull();
    expect(usernameProblem("валя")).toBe("Только латинские буквы, цифры и _");
    expect(usernameProblem("va lya")).toBe("Только латинские буквы, цифры и _");
    expect(usernameProblem("va")).toBe("Минимум 3 символа");
  });
});

describe("who sees the first-run card", () => {
  it("is shown to a signed-in account without a username, after its profile loads", () => {
    const loading = renderHook(() => useWelcome({ accountId: "u1", profileReady: false, savedUsername: "" }));
    expect(loading.result.current.open).toBe(false);
    const ready = renderHook(() => useWelcome({ accountId: "u1", profileReady: true, savedUsername: "" }));
    expect(ready.result.current.open).toBe(true);
  });

  it("is never shown without an account (demo mode) or to someone with a username", () => {
    expect(renderHook(() => useWelcome({ accountId: null, profileReady: true, savedUsername: "" })).result.current.open).toBe(false);
    expect(renderHook(() => useWelcome({ accountId: "u1", profileReady: true, savedUsername: "valya" })).result.current.open).toBe(false);
  });

  it("is shown once per account", () => {
    const first = renderHook(() => useWelcome({ accountId: "u1", profileReady: true, savedUsername: "" }));
    act(() => first.result.current.finish());
    expect(first.result.current.open).toBe(false);
    expect(localStorage.getItem(welcomeKey("u1"))).toBe("1");
    expect(renderHook(() => useWelcome({ accountId: "u1", profileReady: true, savedUsername: "" })).result.current.open).toBe(false);
    expect(renderHook(() => useWelcome({ accountId: "u2", profileReady: true, savedUsername: "" })).result.current.open).toBe(true);
  });
});
