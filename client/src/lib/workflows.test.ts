import { describe, expect, it } from "vitest";
import { nextCaseStatuses } from "./workflows";

describe("reconciliation case transitions", () => {
  it("does not offer a direct resolution from an open case", () => {
    expect(nextCaseStatuses("OPEN")).not.toContain("RESOLVED");
    expect(nextCaseStatuses("OPEN")).toContain("INVESTIGATING");
  });

  it("offers resolution only after investigation or escalation", () => {
    expect(nextCaseStatuses("INVESTIGATING")).toContain("RESOLVED");
    expect(nextCaseStatuses("RESOLVED")).toEqual([]);
  });
});
