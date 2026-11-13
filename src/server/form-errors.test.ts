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
