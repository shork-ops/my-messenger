import { expect, it } from "vitest";
import { maintenanceAuthorized } from "../../supabase/functions/_shared/maintenanceAuth";
it("rejects anonymous calls, user JWTs and missing configuration", async () => {
  expect(await maintenanceAuthorized(null, "maintenance-secret")).toBe(false);
  expect(await maintenanceAuthorized("Bearer normal-user-token", "maintenance-secret")).toBe(false);
  expect(await maintenanceAuthorized("Bearer ", "")).toBe(false);
  expect(await maintenanceAuthorized("Bearer maintenance-secret", "maintenance-secret")).toBe(true);
});
