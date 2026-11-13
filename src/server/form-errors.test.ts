import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fieldErrors } from "./form-errors";

describe("fieldErrors", () => {
  it("never shows zod's internal wording for a missing field (regression: unselected dropdown)", () => {
    const r = z.object({ accountId: z.string().uuid("Choose an account.") }).safeParse({});
    expect(r.success).toBe(false);
    if (!r.success) expect(fieldErrors(r.error).accountId).toBe("Choose or fill in this field.");
  });
  it("keeps specific messages for present-but-wrong values", () => {
    const r = z.object({ accountId: z.string().uuid("Choose an account.") }).safeParse({ accountId: "nope" });
    if (!r.success) expect(fieldErrors(r.error).accountId).toBe("Choose an account.");
  });
});

describe("fieldErrors keeps deliberate messages", () => {
  it("keeps a custom message even when zod reports it as a type error (regression: 80.5% threshold)", () => {
    const r = z.object({ n: z.coerce.number().int("Use a whole number.") }).safeParse({ n: "80.5" });
    if (!r.success) expect(fieldErrors(r.error).n).toBe("Use a whole number.");
    else throw new Error("should fail");
  });
});
