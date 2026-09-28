import { describe, expect, it } from "vitest";
import { Permission, can, visibleNav } from "./permissions";

describe("permissions", () => {
  it("grants an action only when the permission string is present", () => {
    expect(can(["payments.read"], Permission.PAYMENTS_CAPTURE)).toBe(false);
    expect(can(["payments.capture"], Permission.PAYMENTS_CAPTURE)).toBe(true);
  });

  it("hides financial navigation from a user who cannot read that domain", () => {
    const labels = visibleNav(["payments.read"]).map((item) => item.label);
    expect(labels).toContain("Payments");
    expect(labels).toContain("Dashboard");
    expect(labels).not.toContain("Ledger");
    expect(labels).not.toContain("Operations");
  });

  it("does not treat a role name as a permission", () => {
    expect(can(["PLATFORM_ADMIN"], Permission.ADMIN_OPERATIONS)).toBe(false);
  });
});
