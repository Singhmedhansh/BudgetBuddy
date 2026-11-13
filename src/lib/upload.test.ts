import { describe, expect, it } from "vitest";
import { checkUpload, MAX_ATTACHMENT_BYTES, safeFilename, sniffType } from "./upload";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const PDF = new TextEncoder().encode("%PDF-1.7\n...");
const TXT = new TextEncoder().encode("hello\nworld");
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0, 0, 0]); // MZ header

describe("sniffType", () => {
  it("identifies allowed types by content", () => {
    expect(sniffType(PNG)).toBe("image/png");
    expect(sniffType(JPG)).toBe("image/jpeg");
    expect(sniffType(PDF)).toBe("application/pdf");
    expect(sniffType(TXT)).toBe("text/plain");
  });
  it("rejects executables and binary data", () => {
    expect(sniffType(EXE)).toBeNull();
    expect(sniffType(new Uint8Array([1, 2, 3, 0, 5]))).toBeNull();
    expect(sniffType(new Uint8Array())).toBeNull();
  });
});

describe("checkUpload", () => {
  it("accepts a genuine file", () => {
    expect(checkUpload({ name: "Screenshot 1.PNG", size: PNG.length }, PNG)).toMatchObject({ ok: true, type: "image/png" });
  });
  it("rejects a disguised file: executable named .png, or png content named .exe", () => {
    expect(checkUpload({ name: "invoice.png", size: 8 }, EXE).ok).toBe(false);
    expect(checkUpload({ name: "run.exe", size: PNG.length }, PNG).ok).toBe(false);
  });
  it("rejects empty and oversized files", () => {
    expect(checkUpload({ name: "a.png", size: 0 }, PNG).ok).toBe(false);
    expect(checkUpload({ name: "a.png", size: MAX_ATTACHMENT_BYTES + 1 }, PNG).ok).toBe(false);
  });
});

describe("safeFilename", () => {
  it("strips paths and unsafe characters", () => {
    expect(safeFilename("../../etc/passwd")).toBe("passwd");
    expect(safeFilename("C:\\Users\\x\\my file (1).png")).toBe("my_file_1_.png");
    expect(safeFilename("...hidden")).toBe("hidden");
    expect(safeFilename("")).toBe("file");
  });
});
