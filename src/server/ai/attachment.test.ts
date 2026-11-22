import { describe, expect, it } from "vitest";
import { referenceReviewStatus } from "@/config/reference-data";
import { readAttachment } from "./attachment";

const file = (content: string | Uint8Array, name: string, type = "") =>
  new File([content as BlobPart], name, { type });

describe("attaching a file to a question", () => {
  it("reads a CSV or text file", async () => {
    const r = await readAttachment(
      file(
        "date,amount\n2026-11-01,450.00\n2026-11-02,120.00",
        "statement.csv",
      ),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toContain("450.00");
  });
  it("cuts a very long file at the cap and says so", async () => {
    const r = await readAttachment(file("a ".repeat(20_000), "big.txt"));
    expect(r.ok && r.text.length).toBe(12_000);
    expect(r.ok && r.truncated).toBe(true);
  });
  it("refuses other types, empty files and oversized files", async () => {
    expect((await readAttachment(file("x", "photo.png", "image/png"))).ok).toBe(
      false,
    );
    expect((await readAttachment(file("", "empty.txt"))).ok).toBe(false);
    expect(
      (
        await readAttachment(
          file(new Uint8Array(3 * 1024 * 1024 + 1), "huge.csv"),
        )
      ).ok,
    ).toBe(false);
    expect((await readAttachment(file("   \n  ", "blank.txt"))).ok).toBe(false);
  });
  it("refuses a PDF that is not a real PDF without crashing", async () => {
    const r = await readAttachment(
      file("not a pdf", "slip.pdf", "application/pdf"),
    );
    expect(r.ok).toBe(false);
  });
});

describe("reference figures review", () => {
  it("is due once the last check is over 35 days old", () => {
    expect(referenceReviewStatus(new Date("2026-12-01T00:00:00Z")).due).toBe(
      false,
    );
    const late = referenceReviewStatus(new Date("2027-01-05T00:00:00Z"));
    expect(late.due).toBe(true);
    expect(late.items.length).toBeGreaterThan(5);
  });
});
