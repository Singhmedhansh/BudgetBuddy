import { baselineDailySpend, type ScheduledEvent } from "@/domain/forecast";
import { periodTotals, type LedgerAccount } from "@/domain/ledger";
import { occurrencesBetween, addDays, type Frequency } from "@/domain/recurrence";
import { requireSpace } from "./context";
import { listAccounts, postingsInRange } from "./queries";
import { todayFor } from "./planning";

type Ctx = Awaited<ReturnType<typeof requireSpace>>;

const SPENDABLE = ["savings", "current", "cash", "wallet"] as const;
const WINDOW_DAYS = 60;

export interface ForecastBasis {
  today: string;
  startBalance: number;
  accountNames: string[];
  events: ScheduledEvent[];
  dailySpend: number;
  confidence: "low" | "medium" | "high";
  basisDays: number;
  historyDays: number;
}

/** Gathers everything the projection needs from the user's own records. */
export async function forecastBasis(ctx: Ctx, horizonDays: number): Promise<ForecastBasis> {
  const today = todayFor(ctx);
  const end = addDays(today, horizonDays);
  const windowStart = addDays(today, -WINDOW_DAYS);

  const accounts = (await listAccounts(ctx)).filter((a) => (SPENDABLE as readonly string[]).includes(a.type));
  const startBalance = accounts.reduce((s, a) => s + a.balance, 0);

  const [{ data: items }, { data: pays }, { data: terms }, { data: first }] = await Promise.all([
    ctx.supabase.from("recurring_items").select("*").eq("space_id", ctx.space.id).eq("status", "active"),
    ctx.supabase.from("recurring_payments").select("item_id,due_date,paid_on").eq("space_id", ctx.space.id),
    ctx.supabase.from("debt_terms").select("account_id,min_payment,due_day").eq("space_id", ctx.space.id),
    ctx.supabase.from("transactions").select("occurred_at").eq("space_id", ctx.space.id).in("type", ["expense", "income"]).order("occurred_at", { ascending: true }).limit(1),
  ]);

  const settled = new Set((pays ?? []).map((p) => `${p.item_id}|${p.due_date}`));
  const events: ScheduledEvent[] = [];
  for (const i of items ?? []) {
    const schedule = { frequency: i.frequency as Frequency, firstDue: i.first_due as string, endsOn: (i.ends_on as string | null) ?? null };
    for (const d of occurrencesBetween(schedule, addDays(today, -90), end)) {
      if (settled.has(`${i.id}|${d}`)) continue;
      events.push({ date: d, amount: i.kind === "income" ? Number(i.amount) : -Number(i.amount), label: i.name as string, nature: "scheduled" });
    }
  }
  // Debt minimum payments on their due day each month: an estimate from the user's own terms.
  const debtAccounts = new Map((await listAccounts(ctx)).map((a) => [a.id, a]));
  for (const t of terms ?? []) {
    const acct = debtAccounts.get(t.account_id as string);
    if (!acct || acct.balance <= 0 || !t.due_day || !Number(t.min_payment)) continue;
    let [y, m] = today.split("-").map(Number);
    for (let k = 0; k <= Math.ceil(horizonDays / 28) + 1; k++) {
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const date = `${y}-${String(m).padStart(2, "0")}-${String(Math.min(Number(t.due_day), last)).padStart(2, "0")}`;
      if (date > today && date <= end) events.push({ date, amount: -Number(t.min_payment), label: `${acct.name} minimum payment`, nature: "estimate" });
      m++;
      if (m > 12) { m = 1; y++; }
    }
  }

  // Everyday spending: recent expenses minus what recurring items already account for.
  const todayStart = new Date(`${today}T00:00:00Z`);
  const winFrom = new Date(todayStart.getTime() - WINDOW_DAYS * 86400000 - 86400000);
  const winTo = new Date(todayStart.getTime() + 2 * 86400000);
  const { postings, kinds } = await postingsInRange(ctx, winFrom, winTo);
  const ledger: LedgerAccount[] = [...kinds].map(([id, kind]) => ({ id, kind, currency: ctx.space.currency }));
  const spendTotal = periodTotals(ledger, postings, winFrom, winTo).expenses;
  const itemAmount = new Map((items ?? []).map((i) => [i.id as string, { amount: Number(i.amount), kind: i.kind as string }]));
  const recurringSettledTotal = (pays ?? [])
    .filter((p) => (p.paid_on as string) >= windowStart)
    .reduce((s, p) => {
      const it = itemAmount.get(p.item_id as string);
      return it && it.kind !== "income" ? s + it.amount : s;
    }, 0);
  const firstDate = first?.[0]?.occurred_at ? String(first[0].occurred_at).slice(0, 10) : today;
  const historyDays = Math.max(0, Math.round((Date.parse(today) - Date.parse(firstDate)) / 86400000));
  const base = baselineDailySpend({ spendTotal, recurringSettledTotal, historyDays });

  return {
    today,
    startBalance,
    accountNames: accounts.map((a) => a.name),
    events,
    dailySpend: base.perDay,
    confidence: base.confidence,
    basisDays: base.basisDays,
    historyDays,
  };
}
