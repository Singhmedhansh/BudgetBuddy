import type { z } from "zod";

/**
 * Field errors for a form. A missing or wrong-typed value (for example an
 * unselected dropdown, which browsers leave out of the submission) would
 * otherwise surface zod's internal wording, so it is replaced with plain text.
 */
export function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) {
    const key = String(i.path[0] ?? "form");
    if (out[key]) continue;
    out[key] = /^Invalid input/.test(i.message) ? "Choose or fill in this field." : i.message;
  }
  return out;
}
