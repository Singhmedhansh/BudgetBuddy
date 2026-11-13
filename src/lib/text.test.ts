import { describe, expect, it } from "vitest";
import { nameMatches, stem } from "./text";

describe("stem", () => {
  it("equates singular and plural forms", () => {
    expect(stem("Groceries")).toBe(stem("grocery"));
    expect(stem("budgets")).toBe(stem("budget"));
    expect(stem("boxes")).toBe(stem("box"));
    expect(stem("class")).toBe("class");
  });
});

describe("nameMatches", () => {
  it("matches a category by a natural word", () => {
    expect(nameMatches("Groceries", "grocery")).toBe(true);
    expect(nameMatches("EMI and loans", "loan")).toBe(true);
    expect(nameMatches("Rent", "grocery")).toBe(false);
  });
  it("requires every query word and ignores an empty query", () => {
    expect(nameMatches("EMI and loans", "emi loan")).toBe(true);
    expect(nameMatches("EMI and loans", "emi rent")).toBe(false);
    expect(nameMatches("Rent", "")).toBe(false);
  });
});
