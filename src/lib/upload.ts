/**
 * Safe file validation for user uploads. The declared type and filename are
 * never trusted: the file's leading bytes decide what it is, and the extension
 * and size must agree with an allow-list.
 */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export type AllowedType = "image/png" | "image/jpeg" | "application/pdf" | "text/plain";

const EXT: Record<AllowedType, string[]> = {
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "application/pdf": ["pdf"],
  "text/plain": ["txt"],
};

export function sniffType(bytes: Uint8Array): AllowedType | null {
  const starts = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (bytes.length >= 8 && starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (bytes.length >= 3 && starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (bytes.length >= 5 && starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  // Plain text: no NUL bytes or other control characters in the first 4 KB.
  const head = bytes.subarray(0, 4096);
  if (head.length > 0 && head.every((b) => b === 9 || b === 10 || b === 13 || (b >= 32 && b !== 127))) return "text/plain";
  return null;
}

export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(-80);
  return cleaned || "file";
}

export type UploadCheck = { ok: true; type: AllowedType; filename: string } | { ok: false; reason: string };

export function checkUpload(file: { name: string; size: number }, bytes: Uint8Array): UploadCheck {
  if (file.size === 0) return { ok: false, reason: "The file is empty." };
  if (file.size > MAX_ATTACHMENT_BYTES) return { ok: false, reason: "The file is larger than 5 MB." };
  const type = sniffType(bytes);
  if (!type) return { ok: false, reason: "Attach a PNG, JPG, PDF or plain text file." };
  const filename = safeFilename(file.name);
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (!EXT[type].includes(ext)) return { ok: false, reason: "The file extension does not match its contents." };
  return { ok: true, type, filename };
}
