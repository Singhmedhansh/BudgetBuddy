import { describe, expect, it } from "vitest";
import { CsvError, parseCsv, safeCell, toCsv } from "./csv";
import { detectMapping, fingerprints, parseStatementAmount, parseStatementDate, parseStatementRows } from "./statement";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, embedded commas and newlines, CRLF and BOM", () => {
    const text = '﻿Date,Description,Amount\r\n01/11/2026,"Cafe, Bandra",-250.00\r\n02/11/2026,"He said ""hi""\nthere",100\r\n';
    expect(parseCsv(text)).toEqual([
      ["Date", "Description", "Amount"],
      ["01/11/2026", "Cafe, Bandra", "-250.00"],
      ["02/11/2026", 'He said "hi"\nthere', "100"],
    ]);
  });
  it("skips blank lines, keeps empty cells, tolerates a missing final newline", () => {
    expect(parseCsv("a,b,c\n\n1,,3")).toEqual([["a", "b", "c"], ["1", "", "3"]]);
  });
  it("rejects an unclosed quote", () => {
    expect(() => parseCsv('a,b\n"unterminated,1')).toThrow(CsvError);
  });
});

describe("CSV export is safe against formula injection", () => {
  it("neutralises cells that start a formula", () => {
    for (const bad of ["=HYPERLINK(\"http://evil\")", "+1+1", "-2+3", "@SUM(A1)", "\tcmd"]) expect(safeCell(bad).startsWith("'")).toBe(true);
    expect(safeCell("Groceries")).toBe("Groceries");
  });
  it("quotes cells with commas, quotes or newlines and leaves raw numbers untouched", () => {
    const csv = toCsv([["Name", "Amount"], ['=cmd|"x"', { raw: "-250.00" }], ["Cafe, Bandra", { raw: "100.00" }]]);
    expect(csv).toBe("Name,Amount\r\n\"'=cmd|\"\"x\"\"\",-250.00\r\n\"Cafe, Bandra\",100.00\r\n");
    expect(parseCsv(csv)[1][1]).toBe("-250.00"); // a genuine negative number is not mangled
  });
  it("round-trips through the parser", () => {
    const rows = [["a", "b"], ["x,y", 'q"r'], ["line\nbreak", "z"]];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe("statement dates", () => {
  it("reads common formats", () => {
    expect(parseStatementDate("2026-11-05", "dmy")).toBe("2026-11-05");
    expect(parseStatementDate("05/11/2026", "dmy")).toBe("2026-11-05");
    expect(parseStatementDate("05-11-26", "dmy")).toBe("2026-11-05");
    expect(parseStatementDate("5 Nov 2026", "dmy")).toBe("2026-11-05");
    expect(parseStatementDate("05-Nov-2026", "dmy")).toBe("2026-11-05");
  });
  it("resolves ambiguous numeric dates by the chosen order, never by guessing", () => {
    expect(parseStatementDate("03/04/2026", "dmy")).toBe("2026-04-03");
    expect(parseStatementDate("03/04/2026", "mdy")).toBe("2026-03-04");
    expect(parseStatementDate("13/04/2026", "mdy")).toBeNull(); // month 13 is not real
  });
  it("rejects impossible and unreadable dates", () => {
    expect(parseStatementDate("31/02/2026", "dmy")).toBeNull();
    expect(parseStatementDate("yesterday", "dmy")).toBeNull();
    expect(parseStatementDate("", "dmy")).toBeNull();
  });
});

describe("statement amounts", () => {
  it("reads signs, thousands separators, brackets, symbols and Dr/Cr", () => {
    expect(parseStatementAmount("1,234.50", "INR")).toBe(123450);
    expect(parseStatementAmount("-250", "INR")).toBe(-25000);
    expect(parseStatementAmount("(500.00)", "INR")).toBe(-50000);
    expect(parseStatementAmount("₹ 1,200.00", "INR")).toBe(120000);
    expect(parseStatementAmount("800 Dr", "INR")).toBe(-80000);
    expect(parseStatementAmount("800.00 CR", "INR")).toBe(80000);
    expect(parseStatementAmount("INR 99.5", "INR")).toBe(9950);
    expect(parseStatementAmount("500", "JPY")).toBe(500);
  });
  it("rejects precision beyond the currency, text and blanks instead of rounding", () => {
    expect(parseStatementAmount("10.123", "INR")).toBeNull();
    expect(parseStatementAmount("10.5", "JPY")).toBeNull();
    expect(parseStatementAmount("abc", "INR")).toBeNull();
    expect(parseStatementAmount("", "INR")).toBeNull();
  });
});

describe("column detection and row parsing", () => {
  const single = [
    ["Account statement"],
    ["Date", "Narration", "Amount"],
    ["01/11/2026", "UPI Fresh Basket", "-1842.50"],
    ["02/11/2026", "Salary Acme", "65000.00"],
    ["31/02/2026", "Bad date", "10"],
    ["03/11/2026", "Gift", "10.555"],
    ["04/11/2026", "", "5"],
    ["05/11/2026", "Zero", "0"],
  ];
  it("finds the header row after a preamble and the right columns", () => {
    const d = detectMapping(single)!;
    expect(d.headerRow).toBe(1);
    expect(d.mapping).toEqual({ date: 0, description: 1, amount: 2 });
  });
  it("returns good rows and a reason for every bad one, silently dropping nothing", () => {
    const d = detectMapping(single)!;
    const r = parseStatementRows(single, d.headerRow, d.mapping, { currency: "INR", dateOrder: "dmy" });
    expect(r.rows.map((x) => [x.date, x.amount])).toEqual([["2026-11-01", -184250], ["2026-11-02", 6500000]]);
    expect(r.problems.map((p) => p.line)).toEqual([5, 6, 7, 8]);
    expect(r.rows.length + r.problems.length).toBe(single.length - 2);
  });
  it("supports separate debit and credit columns and rejects rows with both", () => {
    const rows = [["Txn Date", "Details", "Withdrawal Amt", "Deposit Amt"], ["01/11/2026", "ATM", "2,000.00", ""], ["02/11/2026", "Refund", "", "350.00"], ["03/11/2026", "Odd", "1", "1"]];
    const d = detectMapping(rows)!;
    expect(d.mapping).toMatchObject({ debit: 2, credit: 3 });
    const r = parseStatementRows(rows, d.headerRow, d.mapping, { currency: "INR", dateOrder: "dmy" });
    expect(r.rows.map((x) => x.amount)).toEqual([-200000, 35000]);
    expect(r.problems).toHaveLength(1);
  });
  it("can flip the sign when positive means money out", () => {
    const rows = [["Date", "Description", "Amount"], ["01/11/2026", "Card spend", "500.00"]];
    const d = detectMapping(rows)!;
    const r = parseStatementRows(rows, d.headerRow, { ...d.mapping, positiveIs: "out" }, { currency: "INR", dateOrder: "dmy" });
    expect(r.rows[0].amount).toBe(-50000);
  });
  it("returns null when it cannot recognise the columns", () => {
    expect(detectMapping([["foo", "bar"], ["1", "2"]])).toBeNull();
  });
});

describe("import fingerprints (idempotency)", () => {
  const row = (line: number, description = "Cafe") => ({ line, date: "2026-11-01", description, amount: -25000 });
  it("two genuine identical purchases in one file get different fingerprints", () => {
    const f = fingerprints("acct", [row(2), row(3)]);
    expect(f[0]).not.toBe(f[1]);
  });
  it("importing the same file again reproduces the same fingerprints", () => {
    expect(fingerprints("acct", [row(2), row(3)])).toEqual(fingerprints("acct", [row(7), row(9)])); // line numbers are irrelevant
  });
  it("differs by account, date, amount and description (case-insensitive)", () => {
    const base = fingerprints("a", [row(2)])[0];
    expect(fingerprints("b", [row(2)])[0]).not.toBe(base);
    expect(fingerprints("a", [{ ...row(2), amount: -25001 }])[0]).not.toBe(base);
    expect(fingerprints("a", [row(2, "CAFE")])[0]).toBe(base);
  });
});
