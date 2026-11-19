import { extractText, getDocumentProxy } from "unpdf";

export type PdfTextResult = { ok: true; text: string; pages: number } | { ok: false; reason: "encrypted" | "unreadable" | "no_text" };

const MAX_PAGES = 30;

/** Text of a text-based PDF, page by page with line breaks kept. A scan or photo has no text layer and yields "no_text". */
export async function pdfText(bytes: Uint8Array): Promise<PdfTextResult> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    if (pdf.numPages > MAX_PAGES) return { ok: false, reason: "unreadable" };
    const { text, totalPages } = await extractText(pdf, { mergePages: false });
    const joined = (Array.isArray(text) ? text : [text]).join("\n").replace(/[ \t]+\n/g, "\n").trim();
    if (joined.replace(/\s/g, "").length < 40) return { ok: false, reason: "no_text" };
    return { ok: true, text: joined, pages: totalPages };
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    return { ok: false, reason: name === "PasswordException" ? "encrypted" : "unreadable" };
  }
}
