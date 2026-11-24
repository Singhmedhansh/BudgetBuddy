import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildRecap } from "../ai/recap";
import type { Facts } from "../ai/grounding";
import { isReviewer, reviewerEmails } from "../ai/reviewers";
import { parseIncoming, verifySignature } from "./api";
import {
  describeAction,
  forWhatsApp,
  parseConfirm,
  parseLinkCode,
} from "./text";

describe("WhatsApp webhook safety", () => {
  const secret = "app-secret-value";
  const body = JSON.stringify({ hello: "world" });
  const sig =
    "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  it("accepts only a body signed with the app secret", () => {
    expect(verifySignature(body, sig, secret)).toBe(true);
    expect(verifySignature(body + " ", sig, secret)).toBe(false);
    expect(verifySignature(body, sig, "other-secret")).toBe(false);
    expect(verifySignature(body, null, secret)).toBe(false);
    expect(verifySignature(body, "sha256=zz", secret)).toBe(false);
    expect(verifySignature(body, sig.replace("sha256=", ""), secret)).toBe(
      false,
    );
  });
  it("reads text messages and skips everything else", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: "m1",
                    from: "919876543210",
                    type: "text",
                    text: { body: "hello" },
                  },
                  { id: "m2", from: "919876543210", type: "image" },
                  {
                    id: "m3",
                    from: "919876543210",
                    type: "text",
                    text: { body: "" },
                  },
                ],
                statuses: [{ id: "s1" }],
              },
            },
          ],
        },
      ],
    };
    expect(parseIncoming(payload)).toEqual([
      { id: "m1", from: "919876543210", text: "hello" },
    ]);
    expect(parseIncoming(null)).toEqual([]);
    expect(parseIncoming({ entry: "x" })).toEqual([]);
  });
});

describe("WhatsApp message reading", () => {
  it("finds a link code only in the exact form", () => {
    expect(parseLinkCode("LINK 123456")).toBe("123456");
    expect(parseLinkCode("  link   654321 ")).toBe("654321");
    expect(parseLinkCode("link 12345")).toBeNull();
    expect(parseLinkCode("please link 123456 now")).toBeNull();
  });
  it("reads yes and no, and nothing ambiguous", () => {
    expect(parseConfirm("YES")).toBe("yes");
    expect(parseConfirm("ok.")).toBe("yes");
    expect(parseConfirm("No")).toBe("no");
    expect(parseConfirm("cancel")).toBe("no");
    expect(parseConfirm("yes but make it 500")).toBeNull();
    expect(parseConfirm("how much did I spend")).toBeNull();
  });
  it("turns markdown into WhatsApp text and caps the length", () => {
    const md =
      "### Plan\n**Do this first.**\n- one\n- two\n\n| A | B |\n| --- | --- |\n| 1 | 2 |";
    const out = forWhatsApp(md);
    expect(out).toContain("*Plan*");
    expect(out).toContain("*Do this first.*");
    expect(out).toContain("• one");
    expect(out).toContain("• A · B");
    expect(out).not.toContain("---");
    expect(forWhatsApp("x".repeat(3000)).length).toBeLessThanOrEqual(1400);
  });
  it("says exactly what a change will do", () => {
    expect(
      describeAction({
        kind: "add_transaction",
        type: "expense",
        amount: 450,
        amountDisplay: "₹450.00",
        accountId: "a",
        accountName: "HDFC Savings",
        categoryId: "c",
        categoryName: "Groceries",
        date: "2026-11-23",
        merchant: null,
        clientKey: "k",
      }),
    ).toBe(
      "Add expense of ₹450.00 in Groceries, from HDFC Savings, dated 2026-11-23.",
    );
  });
});

describe("weekly recap", () => {
  const facts: Facts = {
    asOf: "2026-11-23",
    space: { name: "Home", currency: "INR", sample: false },
    netWorth: "20000.00",
    held: "125000.00",
    owed: "5000.00",
    accounts: [],
    thisMonth: {
      label: "November 2026",
      income: "60000.00",
      spending: "42000.00",
      net: "18000.00",
      keptPercent: 30,
    },
    topCategories: [{ name: "Rent <b>", amount: "15000.00", percent: 36 }],
    budgets: [],
    bills: [
      {
        name: "Rent",
        kind: "bill",
        amount: "15000.00",
        due: "2026-12-01",
        state: "upcoming",
      },
    ],
  };
  it("builds the email from the verified figures, with every name escaped", () => {
    const r = buildRecap(facts, {
      name: "Asha",
      origin: "https://getfintrack.online/",
    })!;
    expect(r.subject).toContain("₹42,000");
    expect(r.text).toContain("Hi Asha,");
    expect(r.text).toContain("https://getfintrack.online/app/assistant");
    expect(r.html).toContain("Rent &lt;b&gt;");
    expect(r.html).not.toContain("Rent <b>");
  });
  it("sends nothing to someone with no activity yet", () => {
    const empty: Facts = {
      ...facts,
      thisMonth: { ...facts.thisMonth, income: "0.00", spending: "0.00" },
      topCategories: [],
      bills: [],
    };
    expect(
      buildRecap(empty, { name: null, origin: "https://x.test" }),
    ).toBeNull();
  });
});

describe("review queue access", () => {
  it("is closed unless the address is listed", () => {
    const env = {
      FINN_REVIEWERS: "Owner@Example.com, bad, second@x.io",
    } as unknown as NodeJS.ProcessEnv;
    expect(reviewerEmails(env)).toEqual(["owner@example.com", "second@x.io"]);
    expect(isReviewer("OWNER@example.com", env)).toBe(true);
    expect(isReviewer("someone@else.com", env)).toBe(false);
    expect(isReviewer(null, env)).toBe(false);
    expect(isReviewer("owner@example.com", {} as unknown as NodeJS.ProcessEnv)).toBe(
      false,
    );
  });
});
