/**
 * The device list in Settings → Данные.
 *
 * The server's list is what a person needs - "is my old phone still signed in?" - so the tests
 * walk that path: every session shows, this device is marked and cannot be ended from here,
 * another one can, and a project without the migration still gets this browser's own list and
 * the "Выйти на других" button.
 */

/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const rpc = vi.fn();
vi.mock("../lib/supabase", () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }));

const { default: DevicesPanel } = await import("./DevicesPanel");

const here = {
  id: "s-here",
  created_at: "2026-10-01T10:00:00Z",
  last_active: new Date().toISOString(),
  user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130",
  ip: "10.0.0.1",
  is_current: true,
};
const phone = {
  id: "s-phone",
  created_at: "2026-09-01T10:00:00Z",
  last_active: new Date(Date.now() - 2 * 24 * 3600_000).toISOString(),
  user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1",
  ip: "10.0.0.2",
  is_current: false,
};
const localDevices = [{ deviceId: "local-1", label: "Chrome", platform: "Windows", lastSeen: Date.now() }];

function renderPanel(onSignOutOthers = vi.fn()) {
  const view = render(<DevicesPanel localDevices={localDevices} currentDeviceId="local-1" onSignOutOthers={onSignOutOthers} signingOut={false} />);
  const buttons = () => Array.from(view.container.querySelectorAll("button")).map((button) => button.textContent?.trim());
  return { ...view, buttons };
}

beforeEach(() => {
  rpc.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the device list", () => {
  it("shows every session of the account, this device marked", async () => {
    rpc.mockResolvedValue({ data: [phone, here], error: null });
    const panel = renderPanel();
    await waitFor(() => expect(panel.container.textContent).toContain("2 устройства"));
    const rows = Array.from(panel.container.querySelectorAll(".device-list li")).map((row) => row.textContent);
    expect(rows[0]).toContain("Chrome · Windows");
    expect(rows[0]).toContain("это устройство");
    expect(rows[1]).toContain("Safari · iOS");
    expect(rows[1]).toContain("2 дн назад · 10.0.0.2");
    expect(panel.buttons()).toEqual(["Выйти на других", "Завершить"]);
    expect(rpc).toHaveBeenCalledWith("my_sessions");
  });

  it("ends another session after asking, and says what happens next", async () => {
    rpc.mockImplementation(async (name: string) => (name === "my_sessions" ? { data: [here, phone], error: null } : { data: true, error: null }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const panel = renderPanel();
    await waitFor(() => expect(panel.buttons()).toContain("Завершить"));
    fireEvent.click(panel.getByRole("button", { name: "Завершить сеанс: Safari · iOS" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Safari · iOS"));
    await waitFor(() => expect(panel.getByRole("status").textContent).toContain("выйдет из аккаунта в течение часа"));
    expect(rpc).toHaveBeenCalledWith("end_session", { target: "s-phone" });
    expect(panel.container.querySelectorAll(".device-list li")).toHaveLength(1);
    expect(panel.container.textContent).toContain("Только это устройство");
    expect(panel.buttons()).toEqual([]);
  });

  it("does nothing when the question is answered «no»", async () => {
    rpc.mockResolvedValue({ data: [here, phone], error: null });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const panel = renderPanel();
    await waitFor(() => expect(panel.buttons()).toContain("Завершить"));
    fireEvent.click(panel.getByRole("button", { name: "Завершить сеанс: Safari · iOS" }));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(panel.container.querySelectorAll(".device-list li")).toHaveLength(2);
  });

  it("without the migration, keeps this browser's list and still offers to sign out elsewhere", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    const onSignOutOthers = vi.fn();
    const panel = renderPanel(onSignOutOthers);
    await waitFor(() => expect(panel.container.textContent).toContain("20261054_account_sessions.sql"));
    expect(panel.container.querySelector(".device-list li")?.textContent).toContain("это устройство");
    fireEvent.click(panel.getByRole("button", { name: "Выйти на других" }));
    expect(onSignOutOthers).toHaveBeenCalledTimes(1);
  });
});
