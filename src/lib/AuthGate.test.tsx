/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("./supabase", () => ({ supabase:null, isSupabaseConfigured:false }));
vi.mock("./constants", () => ({ isDemoMode:false }));
import AuthGate from "./AuthGate";
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });
it("does not show chat content in an unconfigured production build", () => {
  vi.stubEnv("PROD",true);
  render(<AuthGate><div>Private chat</div></AuthGate>);
  expect(screen.queryByText("Private chat")).toBeNull();
  expect(screen.getByRole("alert").textContent).toContain("Сервис временно недоступен");
});
