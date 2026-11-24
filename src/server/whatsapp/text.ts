import type { FinnAction } from "@/server/ai/visuals";

/** "LINK 123456" (any case, extra spaces allowed) sent from the phone being linked. */
export function parseLinkCode(text: string): string | null {
  return /^\s*link\s+(\d{6})\s*$/i.exec(text)?.[1] ?? null;
}

export function parseConfirm(text: string): "yes" | "no" | null {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/, "");
  if (/^(yes|y|confirm|ok|okay|sure|save|save it|do it)$/.test(t)) return "yes";
  if (/^(no|n|cancel|stop|don'?t|discard)$/.test(t)) return "no";
  return null;
}

/** Finn's answer in WhatsApp's own formatting: *bold*, short lines, no markdown tables or headings. */
export function forWhatsApp(markdown: string, max = 1400): string {
  const lines = markdown
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => !/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l))
    .map((l) => {
      if (/^\s*\|.*\|\s*$/.test(l))
        return (
          "• " +
          l
            .split("|")
            .map((c) => c.trim())
            .filter(Boolean)
            .join(" · ")
        );
      return l
        .replace(/^#{1,6}\s+(.*)$/, "*$1*")
        .replace(/\*\*(.+?)\*\*/g, "*$1*")
        .replace(/^\s*[-*]\s+/, "• ");
    });
  const text = lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text;
}

/** One plain sentence saying exactly what a proposed change will do, for the YES / NO message. */
export function describeAction(a: FinnAction): string {
  if (a.kind === "add_transaction")
    return `${a.type === "income" ? "Add income" : "Add expense"} of ${a.amountDisplay} in ${a.categoryName}${a.merchant ? ` (${a.merchant})` : ""}, ${a.type === "income" ? "into" : "from"} ${a.accountName}, dated ${a.date}.`;
  return `Set the ${a.categoryName} limit in "${a.budgetName}" to ${a.amountDisplay}${a.previousDisplay ? ` (now ${a.previousDisplay})` : ""}.`;
}
