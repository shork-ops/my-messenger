/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import StreakCard from "./StreakCard";
import { readStreak, type StreakRow } from "../lib/streakEngine";

const row = (patch: Partial<StreakRow>): StreakRow => ({
  chat_id: "c",
  last_full: "2026-11-01",
  run_days: 7,
  record_days: 9,
  today: "2026-11-01",
  today_mine: true,
  today_theirs: true,
  ...patch,
});

afterEach(cleanup);

describe("StreakCard", () => {
  it("shows the run, the level, the way to the next one and the record", () => {
    render(<StreakCard chatName="Максим" streak={readStreak(row({}))} onClose={() => {}} now={new Date(2026, 10, 1, 12)} />);
    expect(screen.getByRole("dialog", { name: "Огонёк дружбы" })).toBeTruthy();
    expect(screen.getByText("7 дней подряд")).toBeTruthy();
    expect(screen.getByText("Костёр")).toBeTruthy();
    expect(screen.getByText(/До уровня «Пламя»/)).toBeTruthy();
    expect(screen.getByText("ещё 7 дней")).toBeTruthy();
    expect(screen.getByText(/Сегодня уже засчитан/)).toBeTruthy();
    expect(screen.getByText(/Рекорд: 9 дней/)).toBeTruthy();
  });

  it("says what today still needs, and how long is left in the evening", () => {
    const streak = readStreak(row({ last_full: "2026-10-31", run_days: 3, today_theirs: false }));
    render(<StreakCard chatName="Аня" streak={streak} onClose={() => {}} now={new Date(2026, 10, 1, 21, 30)} />);
    expect(screen.getByText(/Ждём ответа/)).toBeTruthy();
    expect(screen.getByText("⏳ До полуночи 2 ч 30 мин")).toBeTruthy();
  });

  it("does not hurry anyone in the afternoon", () => {
    const streak = readStreak(row({ last_full: "2026-10-31", today_mine: false, today_theirs: true }));
    render(<StreakCard chatName="Аня" streak={streak} onClose={() => {}} now={new Date(2026, 10, 1, 14)} />);
    expect(screen.getByText(/ваша очередь/)).toBeTruthy();
    expect(screen.queryByText(/До полуночи/)).toBeNull();
  });

  it("says plainly when the fire went out, and how to light a new one", () => {
    const streak = readStreak(row({ last_full: "2026-10-30", run_days: 12, today_mine: false, today_theirs: false }));
    render(<StreakCard chatName="Игорь" streak={streak} onClose={() => {}} now={new Date(2026, 10, 1, 10)} />);
    expect(screen.getByText("Огонёк погас")).toBeTruthy();
    expect(screen.getByText("вчера, после 12 дней")).toBeTruthy();
    expect(screen.getByText(/Первый уровень — «Искорка»/)).toBeTruthy();
  });

  it("closes on Escape and on the close button", () => {
    const onClose = vi.fn();
    render(<StreakCard chatName="Максим" streak={readStreak(row({}))} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
