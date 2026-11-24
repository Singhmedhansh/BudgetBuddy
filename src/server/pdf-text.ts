import { extractText, getDocumentProxy } from "unpdf";

export type PdfTextResult = { ok: true; text: string; pages: number } | { ok: false; reason: "encrypted" | "wrong_password" | "unreadable" | "no_text" };

const MAX_PAGES = 30;
// pdf.js PasswordException codes: 1 = a password is needed, 2 = the password given is wrong.
const INCORRECT_PASSWORD = 2;

/**
 * Text of a text-based PDF, page by page with line breaks kept. A scan or photo has no text layer and yields "no_text".
 * A password, when given, is used only to open the file in memory for this one read: it is never stored or logged.
 */
export async function pdfText(bytes: Uint8Array, password?: string): Promise<PdfTextResult> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes), password ? { password } : undefined);
    if (pdf.numPages > MAX_PAGES) return { ok: false, reason: "unreadable" };
    const { text, totalPages } = await extractText(pdf, { mergePages: false });
    const joined = (Array.isArray(text) ? text : [text]).join("\n").replace(/[ \t]+\n/g, "\n").trim();
    if (joined.replace(/\s/g, "").length < 40) return { ok: false, reason: "no_text" };
    return { ok: true, text: joined, pages: totalPages };
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name !== "PasswordException") return { ok: false, reason: "unreadable" };
    const code = (e as { code?: number }).code;
    return { ok: false, reason: password && code === INCORRECT_PASSWORD ? "wrong_password" : "encrypted" };
  }
}

/** What to tell a person about a PDF that would not open, in one place for every screen that reads PDFs. */
export const PDF_MESSAGES = {
  encrypted: "This statement is password protected. Enter its password below and upload it again.",
  wrong_password: "That password did not open the file. Banks often use a mix of your name, date of birth or customer ID: check the email the statement came with.",
} as const;
