import { describe, expect, it } from "vitest";
import { looksLikeAction, pickCategory } from "./finn-actions";
import { numberWordsToDigits, parseQuickLog, readDate } from "./quick-log";

// Tuesday 24 November 2026.
const today = { year: 2026, month: 11, day: 24 };
const parse = (m: string) => parseQuickLog(m, today);

describe("recording money from a plain message", () => {
  it("reads the forms people actually type", () => {
    for (const [msg, amount, words] of [
      ["400 spent on food", 400, "food"],
      ["400 on food", 400, "food"],
      ["food 400", 400, "food"],
      ["swiggy ₹250", 250, "swiggy"],
      ["Rs. 1,200 rent", 1200, "rent"],
      ["paid 1200 rent", 1200, "rent"],
      ["spent 2.5k on shoes", 2500, "shoes"],
      ["add a 450 grocery expense", 450, "grocery"],
    ] as const) {
      const r = parse(msg);
      expect(r, msg).not.toBeNull();
      expect(r!.items).toHaveLength(1);
      expect(r!.items[0].amount, msg).toBe(amount);
      expect(r!.items[0].text.toLowerCase(), msg).toContain(words);
      expect(r!.items[0].type, msg).toBe("expense");
    }
  });

  it("knows money coming in", () => {
    expect(parse("got 50k salary")!.items[0]).toMatchObject({
      type: "income",
      amount: 50000,
    });
    expect(parse("salary 50k credited")!.items[0].type).toBe("income");
    expect(parse("received 2000 allowance")!.items[0].type).toBe("income");
  });

  it("splits several entries in one message and keeps words with their amount", () => {
    const r = parse("200 auto, 150 chai and 90 metro yesterday")!;
    expect(r.items.map((i) => i.amount)).toEqual([200, 150, 90]);
    expect(r.items.map((i) => i.text)).toEqual([
      "200 auto",
      "150 chai",
      "90 metro",
    ]);
    expect(r.date).toBe("2026-11-23");
  });

  it("reads amounts spoken into the mic", () => {
    expect(numberWordsToDigits("four hundred on food")).toBe("400 on food");
    expect(numberWordsToDigits("two thousand five hundred rent")).toBe(
      "2500 rent",
    );
    expect(numberWordsToDigits("one and a half")).toBe("one and a half");
    expect(parse("spent four hundred fifty on lunch")!.items[0].amount).toBe(
      450,
    );
  });

  it("never mistakes a question or a statement for a record", () => {
    for (const msg of [
      "How much did I spend on food?",
      "what is a good budget for 400 food",
      "Currently I have 569 in my bank and 1000 in cash",
      "I want to save 7000 for a trip",
      "My salary is 50k per month",
      "Can I afford a 7k monitor",
      "cut food by 20%",
      "Should I invest 10000 in an index fund",
      "hello",
    ])
      expect(parse(msg), msg).toBeNull();
  });

  it("does not treat a long sentence with a number as a record unless asked to", () => {
    expect(
      parse("the trip was fun and the hotel near the beach cost 4000 total"),
    ).toBeNull();
  });
});

describe("the date a message names", () => {
  it("handles relative days, weekdays and day-month, never in the future", () => {
    expect(readDate("400 food", today).date).toBe("2026-11-24");
    expect(readDate("400 food today", today)).toEqual({
      date: "2026-11-24",
      rest: "400 food",
    });
    expect(readDate("400 food day before yesterday", today).date).toBe(
      "2026-11-22",
    );
    expect(readDate("400 food on monday", today)).toEqual({
      date: "2026-11-23",
      rest: "400 food",
    });
    expect(readDate("400 food last tuesday", today).date).toBe("2026-11-17");
    expect(readDate("400 food on 12 nov", today).date).toBe("2026-11-12");
    expect(readDate("400 food Nov 3rd", today).date).toBe("2026-11-03");
    expect(readDate("400 food 12 dec", today).date).toBe("2025-12-12");
  });
});

describe("matching a category", () => {
  const cats = [
    "Food & Dining",
    "Groceries",
    "Transport",
    "Salary",
    "Bills",
  ].map((name, i) => ({ id: String(i), name }));
  it("finds a category by a word of its name or by a merchant", () => {
    expect(pickCategory("400 on food", cats)?.name).toBe("Food & Dining");
    expect(pickCategory("swiggy 250", cats)?.name).toBe("Food & Dining");
    expect(pickCategory("blinkit 600", cats)?.name).toBe("Groceries");
    expect(pickCategory("rapido 90", cats)?.name).toBe("Transport");
    expect(pickCategory("jio recharge 299", cats)?.name).toBe("Bills");
  });
  it("is used to decide whether a message is a request to change something", () => {
    expect(looksLikeAction("400 spent on food")).toBe(true);
    expect(looksLikeAction("How much did I spend on food?")).toBe(false);
  });
});

describe("words that only look like intent", () => {
  it("still records a gift or a plant", () => {
    expect(
      parseQuickLog("gift 500", { year: 2026, month: 11, day: 24 }),
    ).not.toBeNull();
    expect(
      parseQuickLog("paid 300 for a plant", { year: 2026, month: 11, day: 24 }),
    ).not.toBeNull();
  });
});
