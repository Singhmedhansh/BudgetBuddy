import { parseStatementAmount } from "./statement";

/**
 * The closing balance a bank statement prints, read by code from the statement text (never by the AI, so it cannot be
 * invented). Two layouts cover most Indian bank statements:
 *   "Closing Balance : 12,345.67"  (the amount on the same line, after the words)
 *   a summary table whose header row has "Closing Bal(ance)" as its last column and whose next line holds the figures.
 * "Dr" after the figure means overdrawn and is returned as negative. Null when no balance is found, or when more than one
 * different closing balance appears (an ambiguous statement is never guessed at).
 */
const LABEL = /closing\s*(?:bal(?:ance)?|available\s*balance)\b/i;
const AMOUNT = /-?\(?(?:rs\.?|inr|₹)?\s*\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})\)?(?:\s*(?:cr|dr)\b\.?)?|-?\(?(?:rs\.?|inr|₹)?\s*\d+\.\d{1,2}\)?(?:\s*(?:cr|dr)\b\.?)?/gi;

function amounts(line: string): string[] {
  return line.match(AMOUNT)?.map((a) => a.trim()) ?? [];
}

function toMinor(text: string, currency: string): number | null {
  const dr = /dr\.?$/i.test(text);
  const bare = text.replace(/\s*(cr|dr)\.?$/i, "").replace(/rs\.?|inr|₹/gi, "").trim();
  const v = parseStatementAmount(bare, currency);
  if (v === null) return null;
  return dr ? -Math.abs(v) : v;
}

export function closingBalanceFromText(text: string, currency: string): number | null {
  const lines = text.split(/\r?\n/);
  const found = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = LABEL.exec(line);
    if (!m) continue;
    const after = amounts(line.slice(m.index + m[0].length));
    if (after.length > 0) {
      const v = toMinor(after[0], currency);
      if (v !== null) found.add(v);
      continue;
    }
    // A summary table: the label is a column heading; when it is the last heading, the last figure below is the balance.
    const isLastHeading = !/[a-z]/i.test(line.slice(m.index + m[0].length).replace(/[^a-z]/gi, ""));
    const next = (lines[i + 1] ?? "").trim();
    const below = amounts(next);
    if (isLastHeading && below.length > 0) {
      const v = toMinor(below[below.length - 1], currency);
      if (v !== null) found.add(v);
    }
  }
  return found.size === 1 ? [...found][0] : null;
}
