import { describe, expect, it } from "vitest";
import { maskPhone, normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it("accepts an international number and strips spacing and punctuation", () => {
    expect(normalizePhone("+91 98765-43210")).toBe("+919876543210");
    expect(normalizePhone(" +1 (415) 555-0132 ")).toBe("+14155550132");
  });
  it("adds +91 to a bare Indian mobile number, with or without a leading 0", () => {
    expect(normalizePhone("98765 43210")).toBe("+919876543210");
    expect(normalizePhone("09876543210")).toBe("+919876543210");
  });
  it("turns a 00 prefix into +", () => {
    expect(normalizePhone("0044 20 7946 0958")).toBe("+442079460958");
  });
  it("refuses anything that cannot be a real number", () => {
    for (const bad of ["", "abc", "12345", "+0123456789", "+91 12345", "5876543210", "+9198765432101234567", "98765 4321x"]) expect(normalizePhone(bad), bad).toBeNull();
  });
  it("masks the middle of a number", () => {
    expect(maskPhone("+919876543210")).toBe("+91•••••••210");
    expect(maskPhone("+919876543210")).not.toContain("98765");
  });
});
