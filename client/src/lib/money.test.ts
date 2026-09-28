import { describe, expect, it } from "vitest";
import { formatMinor } from "./money";

describe("formatMinor", () => {
  it("keeps minor units exact for values that floats cannot represent cleanly", () => {
    expect(formatMinor("1", "INR")).toBe("0.01 INR");
    expect(formatMinor("10", "INR")).toBe("0.10 INR");
    expect(formatMinor("10000", "INR")).toBe("100.00 INR");
    expect(formatMinor("10050", "USD")).toBe("100.50 USD");
  });

  it("groups thousands and honors zero-exponent currencies", () => {
    expect(formatMinor("100000", "INR")).toBe("1,000.00 INR");
    expect(formatMinor("1000", "JPY")).toBe("1,000 JPY");
    expect(formatMinor("1500", "KWD")).toBe("1.500 KWD");
  });

  it("preserves a leading minus without using numeric conversion", () => {
    expect(formatMinor("-150", "USD")).toBe("-1.50 USD");
  });

  it("refuses values that are not integer minor units", () => {
    expect(formatMinor("10.5", "INR")).toBe("—");
    expect(formatMinor("", "INR")).toBe("—");
  });
});
