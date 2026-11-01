/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import CoolDownSheet, { BREATH_MS, BREATH_STEPS } from "./CoolDownSheet";

const LOUD = "ТЫ ОПЯТЬ НЕ ПРИШЁЛ!!! Я ЖДАЛА ЧАС";

function renderSheet(overrides: Partial<ComponentProps<typeof CoolDownSheet>> = {}) {
  const props: ComponentProps<typeof CoolDownSheet> = {
    text: LOUD,
    morning: null,
    onCool: vi.fn(),
    onSendAnyway: vi.fn(),
    onMorning: vi.fn(),
    onDisable: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<CoolDownSheet {...props} />);
  return props;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CoolDownSheet", () => {
  it("shows the heat and what the message would become", () => {
    renderSheet();
    expect(screen.getByRole("dialog", { name: "Сообщение раскалено" })).toBeTruthy();
    act(() => void vi.advanceTimersByTime(100));
    expect(screen.getByRole("meter", { name: "Накал" }).getAttribute("aria-valuetext")).toMatch(/^\d\d°$/);
    expect(screen.getByText("Ты опять не пришёл! Я ждала час")).toBeTruthy();
  });

  it("puts the softened text back instead of sending it", () => {
    const props = renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /Остудить/ }));
    expect(props.onCool).toHaveBeenCalledWith("Ты опять не пришёл! Я ждала час", "38,6°");
    expect(props.onSendAnyway).not.toHaveBeenCalled();
  });

  it("sends as it is when asked to", () => {
    const props = renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /Отправить как есть/ }));
    expect(props.onSendAnyway).toHaveBeenCalledTimes(1);
  });

  it("offers the morning only where a message can wait on the server", () => {
    renderSheet();
    expect(screen.queryByRole("button", { name: /Отправить утром/ })).toBeNull();
    cleanup();
    const morning = new Date(Date.now() + 3_600_000);
    const props = renderSheet({ morning });
    fireEvent.click(screen.getByRole("button", { name: /Отправить утром/ }));
    expect(props.onMorning).toHaveBeenCalledWith(morning);
  });

  it("breathes for sixteen seconds and then asks again", () => {
    const props = renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /Подышать 16 секунд/ }));
    expect(screen.getByText("Вдох…")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(BREATH_MS));
    expect(screen.getByText("Выдох…")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(BREATH_MS * (BREATH_STEPS - 1)));
    expect(screen.getByRole("dialog", { name: "Ну как, полегчало?" })).toBeTruthy();
    expect(screen.getByRole("meter", { name: "Накал" }).getAttribute("aria-valuetext")).toBe("36,6°");
    // Nothing was sent by waiting.
    expect(props.onSendAnyway).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Поправлю текст/ }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("lets the pause be skipped", () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /Подышать/ }));
    fireEvent.click(screen.getByRole("button", { name: "Пропустить" }));
    expect(screen.getByRole("dialog", { name: "Ну как, полегчало?" })).toBeTruthy();
  });

  it("closes on Escape and can be switched off", () => {
    const props = renderSheet();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Больше не предлагать" }));
    expect(props.onDisable).toHaveBeenCalled();
  });

  it("does not offer to cool what cooling would not change", () => {
    renderSheet({ text: "ТЫ и ОН и МЫ и ВЫ" });
    expect(screen.queryByRole("button", { name: /Остудить/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Подышать/ })).toBeTruthy();
  });
});
