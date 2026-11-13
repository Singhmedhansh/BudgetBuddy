/**
 * Sample data for the preview account: a clearly fictional household with realistic accounts, three months of
 * transactions, budgets, a savings goal and recurring bills. The dataset is generated deterministically (no random
 * numbers, no clock reads other than the date it is given) so it is testable, and it is posted through the same
 * ledger functions as real entries, so every balance and total is genuinely derived from it.
 */
export const SAMPLE_SPACE_NAME = "Sample data · Rao family (fictional)";
export const isSampleSpace = (s: { name: string; is_sample?: boolean } | null | undefined) => Boolean(s && (s.is_sample || s.name.startsWith("Sample data")));

export type AccountKey = "bank" | "savings" | "wallet" | "card";
export interface SampleAccount {
  key: AccountKey;
  name: string;
  type: "current" | "savings" | "cash" | "credit_card";
  /** Minor units, positive. For the card this is the amount owed. */
  opening: number;
}
export interface SampleTxn {
  date: { y: number; m: number; d: number };
  kind: "expense" | "income" | "transfer";
  amount: number;
  from: AccountKey;
  to?: AccountKey;
  category?: string;
  merchant?: string;
}
export interface SampleDataset {
  spaceName: string;
  accounts: SampleAccount[];
  transactions: SampleTxn[];
  budgets: { name: string; warnAt: number; lines: { category: string; amount: number }[] }[];
  goals: { name: string; target: number; contributions: { amount: number; date: { y: number; m: number; d: number }; note: string }[] }[];
  recurring: { kind: "bill" | "subscription" | "income"; name: string; amount: number; frequency: "monthly" | "yearly"; firstDue: string; account: AccountKey; category: string }[];
}

const ymd = (d: { y: number; m: number; d: number }) => `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
const rupees = (n: number) => Math.round(n * 100);

/** Small deterministic generator so the same date always produces the same sample. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shiftMonth(y: number, m: number, back: number) {
  const idx = y * 12 + (m - 1) - back;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function buildSampleDataset(today: { year: number; month: number; day: number }): SampleDataset {
  const rand = rng(today.year * 10000 + today.month * 100 + today.day);
  const between = (lo: number, hi: number) => rupees(Math.round(lo + rand() * (hi - lo)));
  const txns: SampleTxn[] = [];
  const add = (y: number, m: number, d: number, t: Omit<SampleTxn, "date">) => {
    if (d < 1 || d > daysIn(y, m)) return;
    // Never in the future: the app does not allow future-dated transactions.
    if (y > today.year || (y === today.year && (m > today.month || (m === today.month && d > today.day)))) return;
    txns.push({ date: { y, m, d }, ...t });
  };

  for (const back of [2, 1, 0]) {
    const { y, m } = shiftMonth(today.year, today.month, back);
    add(y, m, 1, { kind: "income", amount: rupees(95000), from: "bank", category: "Salary", merchant: "Northfield Labs payroll" });
    add(y, m, 1, { kind: "transfer", amount: rupees(6000), from: "bank", to: "wallet", merchant: "Cash withdrawal" });
    add(y, m, 2, { kind: "transfer", amount: rupees(15000), from: "bank", to: "savings", merchant: "Monthly savings" });
    add(y, m, 3, { kind: "expense", amount: rupees(28000), from: "bank", category: "Rent", merchant: "Greenview Residency" });
    add(y, m, 5, { kind: "expense", amount: between(2600, 3400), from: "bank", category: "Utilities", merchant: "City Power & Water" });
    add(y, m, 7, { kind: "expense", amount: rupees(649), from: "card", category: "Subscriptions", merchant: "StreamBox" });
    add(y, m, 7, { kind: "expense", amount: rupees(199), from: "card", category: "Subscriptions", merchant: "Cloud storage" });
    add(y, m, 9, { kind: "expense", amount: rupees(4500), from: "bank", category: "Kids", merchant: "Little Oaks school fees" });
    const grocers = ["FreshMart", "Daily Basket", "Green Grocer", "Corner Store"];
    const diners = ["Saffron Kitchen", "Cafe Bloom", "Biryani House", "Pizza Corner"];
    [4, 11, 18, 25].forEach((d, i) => add(y, m, d, { kind: "expense", amount: between(2300, 4300), from: "bank", category: "Groceries", merchant: grocers[i] }));
    [6, 13, 20, 27].forEach((d, i) => add(y, m, d, { kind: "expense", amount: between(700, 2100), from: i % 2 ? "card" : "wallet", category: "Dining", merchant: diners[i] }));
    for (const d of [8, 15, 22]) add(y, m, d, { kind: "expense", amount: between(250, 900), from: "wallet", category: "Transport", merchant: d === 15 ? "Metro card top-up" : "Auto and cab rides" });
    add(y, m, 14, { kind: "expense", amount: between(500, 2200), from: "bank", category: "Healthcare", merchant: "Wellness Pharmacy" });
    add(y, m, 16, { kind: "expense", amount: between(900, 2400), from: "card", category: "Household", merchant: "HomeNeeds" });
    if (back === 1) add(y, m, 21, { kind: "income", amount: rupees(12000), from: "bank", category: "Freelance", merchant: "Design project" });
    add(y, m, 28, { kind: "transfer", amount: rupees(8000), from: "bank", to: "card", merchant: "Credit card payment" });
  }
  txns.sort((a, b) => ymd(a.date).localeCompare(ymd(b.date)));

  const inTwoWeeks = new Date(Date.UTC(today.year, today.month - 1, today.day + 9));
  const dueDate = (day: number) => {
    const y = today.year;
    const m = today.month;
    const nextMonth = day <= today.day ? shiftMonth(y, m, -1) : { y, m };
    return `${nextMonth.y}-${String(nextMonth.m).padStart(2, "0")}-${String(Math.min(day, 28)).padStart(2, "0")}`;
  };
  const contributions = [2, 1, 0].map((back) => {
    const { y, m } = shiftMonth(today.year, today.month, back);
    return { amount: rupees(15000), date: { y, m, d: Math.min(back === 0 ? today.day : 2, 28) }, note: "Monthly savings" };
  });

  return {
    spaceName: SAMPLE_SPACE_NAME,
    accounts: [
      { key: "bank", name: "Everyday Bank (sample)", type: "current", opening: rupees(85000) },
      { key: "savings", name: "Savings Vault (sample)", type: "savings", opening: rupees(240000) },
      { key: "wallet", name: "Wallet (sample)", type: "cash", opening: rupees(3500) },
      { key: "card", name: "Credit Card (sample)", type: "credit_card", opening: rupees(12400) },
    ],
    transactions: txns,
    budgets: [
      {
        name: "Monthly household budget",
        warnAt: 80,
        lines: [
          { category: "Groceries", amount: rupees(16000) },
          { category: "Dining", amount: rupees(5000) },
          { category: "Transport", amount: rupees(3500) },
          { category: "Utilities", amount: rupees(4000) },
          { category: "Subscriptions", amount: rupees(1000) },
        ],
      },
    ],
    goals: [{ name: "Emergency fund (sample)", target: rupees(300000), contributions }],
    recurring: [
      { kind: "bill", name: "Rent", amount: rupees(28000), frequency: "monthly", firstDue: dueDate(3), account: "bank", category: "Rent" },
      { kind: "bill", name: "Electricity", amount: rupees(3000), frequency: "monthly", firstDue: `${inTwoWeeks.getUTCFullYear()}-${String(inTwoWeeks.getUTCMonth() + 1).padStart(2, "0")}-${String(inTwoWeeks.getUTCDate()).padStart(2, "0")}`, account: "bank", category: "Utilities" },
      { kind: "subscription", name: "StreamBox", amount: rupees(649), frequency: "monthly", firstDue: dueDate(7), account: "card", category: "Subscriptions" },
      { kind: "income", name: "Salary", amount: rupees(95000), frequency: "monthly", firstDue: dueDate(1), account: "bank", category: "Salary" },
    ],
  };
}
