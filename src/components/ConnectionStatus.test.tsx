/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import ConnectionStatus from "./ConnectionStatus";
afterEach(cleanup);
it("explains offline state and removes the hint when network returns", () => {
  Object.defineProperty(navigator,"onLine",{configurable:true,value:true});
  render(<ConnectionStatus />);
  expect(screen.queryByRole("status")).toBeNull();
  act(() => { Object.defineProperty(navigator,"onLine",{configurable:true,value:false}); window.dispatchEvent(new Event("offline")); });
  expect(screen.getByRole("status").textContent).toContain("Нет сети");
  act(() => { Object.defineProperty(navigator,"onLine",{configurable:true,value:true}); window.dispatchEvent(new Event("online")); });
  expect(screen.queryByRole("status")).toBeNull();
});
