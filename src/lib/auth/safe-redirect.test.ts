import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-redirect";

describe("safeNext", () => {
  it("allows same-site paths", () => {
    expect(safeNext("/app/budgets?month=11")).toBe("/app/budgets?month=11");
  });
  it("falls back for empty, absolute, protocol-relative and tricky targets", () => {
    for (const bad of [null, undefined, "", "https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "/ok\nSet-Cookie:x", "app/x"]) {
      expect(safeNext(bad)).toBe("/app");
    }
  });
  it("uses a custom fallback", () => {
    expect(safeNext("//x", "/login")).toBe("/login");
  });
});
