import { describe, expect, it } from "vitest";
import { canChangeRoles, canManageGroup } from "./groupAdmin";

describe("groupAdmin permissions", () => {
  it("only owners may change roles", () => {
    expect(canChangeRoles("owner")).toBe(true);
    expect(canChangeRoles("admin")).toBe(false);
    expect(canChangeRoles("member")).toBe(false);
    expect(canChangeRoles(null)).toBe(false);
  });

  it("owners and admins may manage the group", () => {
    expect(canManageGroup("owner")).toBe(true);
    expect(canManageGroup("admin")).toBe(true);
    expect(canManageGroup("member")).toBe(false);
    expect(canManageGroup(null)).toBe(false);
  });
});
