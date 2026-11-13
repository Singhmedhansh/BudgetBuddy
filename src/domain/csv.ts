/** CSV reading and writing (RFC 4180), plus protection against spreadsheet formula injection. */

export class CsvError extends Error {}

/** Parses CSV text into rows of cells. Handles quotes, escaped quotes, CRLF and embedded newlines. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    if (!(row.length === 1 && row[0].trim() === "")) rows.push(row); // skip blank lines
    row = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === ",") endCell();
    else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else if (ch === "\n") endRow();
    else cell += ch;
    i++;
  }
  if (quoted) throw new CsvError("The file has an unclosed quote. Check it was exported as a standard CSV.");
  if (cell !== "" || row.length > 0) endRow();
  return rows;
}

/** Characters that make a spreadsheet treat a cell as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Neutralises a cell for CSV export so opening it in Excel or Sheets cannot run
 * a formula. Numbers written by us (including negatives) are passed through
 * `raw` and are not altered.
 */
export function safeCell(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

function quote(cell: string): string {
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export type Cell = string | { raw: string };

export function toCsv(rows: Cell[][]): string {
  return rows.map((r) => r.map((c) => quote(typeof c === "string" ? safeCell(c) : c.raw)).join(",")).join("\r\n") + "\r\n";
}
