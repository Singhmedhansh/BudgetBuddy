import { describe, expect, it } from "vitest";
import { pdfText } from "./pdf-text";
import { tinyPdf } from "@/test/tiny-pdf";

describe("pdfText", () => {
  it("reads the text layer of a text PDF, one line per line", async () => {
    const r = await pdfText(tinyPdf(["HDFC Bank Statement for November 2026", "02/11/2026 SWIGGY ORDER 1234 450.00", "05/11/2026 SALARY NOVEMBER 50,000.00"]));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).toContain("SWIGGY ORDER 1234 450.00");
      expect(r.text).toContain("50,000.00");
      expect(r.text.split("\n").length).toBeGreaterThanOrEqual(3);
    }
  });
  it("reports a PDF with no text (a scan) instead of returning nothing", async () => {
    const r = await pdfText(tinyPdf([]));
    expect(r).toEqual({ ok: false, reason: "no_text" });
  });
  it("reports bytes that are not a PDF as unreadable", async () => {
    expect(await pdfText(new TextEncoder().encode("%PDF-1.4 garbage"))).toEqual({ ok: false, reason: "unreadable" });
  });
});
