import { describe, expect, it } from "vitest";
import { closingBalanceFromText } from "./statement-balance";

describe("closing balance on a statement", () => {
  it("reads a balance printed after the words", () => {
    expect(closingBalanceFromText("Opening Balance : 1,000.00\nClosing Balance : 12,345.67", "INR")).toBe(1_234_567);
    expect(closingBalanceFromText("Closing Bal Rs. 4,50,000.00 Cr", "INR")).toBe(45_000_000);
  });
  it("reads the last figure under a summary table heading", () => {
    const t = "STATEMENT SUMMARY\nOpening Balance Dr Count Cr Count Debits Credits Closing Bal\n10,000.00 12 3 8,250.50 25,000.00 26,749.50";
    expect(closingBalanceFromText(t, "INR")).toBe(2_674_950);
  });
  it("treats Dr as overdrawn", () => {
    expect(closingBalanceFromText("Closing Balance 2,500.00 Dr", "INR")).toBe(-250_000);
  });
  it("gives up rather than guess", () => {
    expect(closingBalanceFromText("No balance here\n01/11/2026 UPI 500.00", "INR")).toBeNull();
    expect(closingBalanceFromText("Closing Balance 100.00\nClosing Balance 200.00", "INR")).toBeNull();
  });
  it("accepts the same balance repeated on every page", () => {
    expect(closingBalanceFromText("Closing Balance 100.00\n...\nClosing Balance 100.00", "INR")).toBe(10_000);
  });
});
