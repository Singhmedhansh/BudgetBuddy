import { pdfText } from "@/server/pdf-text";

export const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
export const MAX_ATTACHMENT_CHARS = 12_000;

export type Attachment =
  | { ok: true; name: string; text: string; truncated: boolean }
  | { ok: false; message: string };

const TEXT_TYPES = /\.(csv|tsv|txt|md)$/i;

/**
 * Turns a file the person attached to a question into text for that one question. Text-like files and text-based PDFs
 * only; nothing is stored, and a scan or photo is refused with a clear reason rather than guessed at.
 */
export async function readAttachment(file: File): Promise<Attachment> {
  const name =
    file.name.replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, 80) || "file";
  if (file.size === 0) return { ok: false, message: "That file is empty." };
  if (file.size > MAX_ATTACHMENT_BYTES)
    return {
      ok: false,
      message: "That file is over 3 MB. Attach a smaller one.",
    };
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text: string;
  if (/\.pdf$/i.test(name) || file.type === "application/pdf") {
    const r = await pdfText(bytes);
    if (!r.ok)
      return {
        ok: false,
        message:
          r.reason === "encrypted"
            ? "That PDF is password-protected. Remove the password and try again."
            : r.reason === "no_text"
              ? "That PDF has no readable text (it may be a scan or photo). Export a text-based PDF or a CSV instead."
              : "That PDF could not be read. Try a CSV export or a smaller PDF.",
      };
    text = r.text;
  } else if (TEXT_TYPES.test(name) || file.type.startsWith("text/")) {
    text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } else {
    return { ok: false, message: "Attach a PDF, CSV or text file." };
  }
  text = text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  if (text.replace(/\s/g, "").length < 10)
    return { ok: false, message: "There is no readable text in that file." };
  return {
    ok: true,
    name,
    text: text.slice(0, MAX_ATTACHMENT_CHARS),
    truncated: text.length > MAX_ATTACHMENT_CHARS,
  };
}
