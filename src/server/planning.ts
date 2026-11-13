import { completionEstimate, goalHealth, goalProgress, monthlyTarget, type GoalHealth } from "@/domain/goals";
import {
  addDays,
  dueState,
  monthlyEquivalent,
  occurrencesBetween,
  yearlyEquivalent,
  type DueState,
  type Frequency,
} from "@/domain/recurrence";
import { localDate } from "@/domain/period";
import { requireSpace } from "./context";
import { listAccounts } from "./queries";
import { isLiability } from "./types";

type Ctx = Awaited<ReturnType<typeof requireSpace>>;

export function todayFor(ctx: Pick<Ctx, "profile">): string {
  const d = localDate(new Date(), ctx.profile.timezone);
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

/* ───────────── goals ───────────── */

export interface GoalView {
  id: string;
  name: string;
  target: number;
  saved: number;
  remaining: number;
  ratio: number;
  deadline: string | null;
  priority: number;
  status: "active" | "paused" | "completed" | "archived";
  monthlyTarget: number | null;
  estimate: string | null;
  health: GoalHealth;
  recent: { id: string; amount: number; date: string; note: string | null }[];
}

export async function listGoals(ctx: Ctx): Promise<GoalView[]> {
  const today = todayFor(ctx);
  const [{ data: goals }, { data: contribs }] = await Promise.all([
    ctx.supabase.from("savings_goals").select("*").eq("space_id", ctx.space.id).neq("status", "archived").order("priority").order("created_at"),
    ctx.supabase.from("goal_contributions").select("id,goal_id,amount,contributed_on,note").eq("space_id", ctx.space.id).order("contributed_on", { ascending: false }),
  ]);
  return (goals ?? []).map((g) => {
    const mine = (contribs ?? []).filter((c) => c.goal_id === g.id);
    const saved = mine.reduce((s, c) => s + Number(c.amount), 0);
    const target = Number(g.target_amount);
    const input = { target, saved, deadline: (g.deadline as string | null) ?? null, today };
    const p = goalProgress(input);
    const estimate = completionEstimate({ target, saved, today, contributions: mine.map((c) => ({ date: c.contributed_on as string, amount: Number(c.amount) })) });
    return {
      id: g.id as string,
      name: g.name as string,
      target,
      saved: p.saved,
      remaining: p.remaining,
      ratio: p.ratio,
      deadline: input.deadline,
      priority: Number(g.priority),
      status: g.status as GoalView["status"],
      monthlyTarget: monthlyTarget(input),
      estimate,
      health: goalHealth(input, estimate),
      recent: mine.slice(0, 3).map((c) => ({ id: c.id as string, amount: Number(c.amount), date: c.contributed_on as string, note: (c.note as string | null) ?? null })),
    };
  });
}

/* ───────────── recurring items ───────────── */

export type ItemKind = "bill" | "subscription" | "income";

export interface RecurringView {
  id: string;
  kind: ItemKind;
  name: string;
  amount: number;
  frequency: Frequency;
  firstDue: string;
  endsOn: string | null;
  status: "active" | "paused" | "cancelled";
  autoRenews: boolean;
  remindDays: number;
  notes: string | null;
  accountName: string | null;
  categoryName: string | null;
  /** The earliest unsettled due date, with its state. Null when finished or not active. */
  due: { date: string; state: DueState } | null;
  monthly: number;
  yearly: number;
  lastSettled: string | null;
}

const LOOKBACK_DAYS = 90;
const LOOKAHEAD_DAYS = 400;

export async function listRecurring(ctx: Ctx, kind: ItemKind): Promise<RecurringView[]> {
  const today = todayFor(ctx);
  const [{ data: items }, { data: pays }, accounts, { data: cats }] = await Promise.all([
    ctx.supabase.from("recurring_items").select("*").eq("space_id", ctx.space.id).eq("kind", kind).order("created_at"),
    ctx.supabase.from("recurring_payments").select("item_id,due_date,paid_on").eq("space_id", ctx.space.id),
    listAccounts(ctx, true),
    ctx.supabase.from("categories").select("id,name").eq("space_id", ctx.space.id),
  ]);
  const accName = new Map(accounts.map((a) => [a.id, a.name]));
  const catName = new Map((cats ?? []).map((c) => [c.id as string, c.name as string]));
  return (items ?? []).map((i) => {
    const paid = new Set((pays ?? []).filter((p) => p.item_id === i.id).map((p) => p.due_date as string));
    const schedule = { frequency: i.frequency as Frequency, firstDue: i.first_due as string, endsOn: (i.ends_on as string | null) ?? null };
    let due: RecurringView["due"] = null;
    if (i.status === "active") {
      const from = addDays(today, -LOOKBACK_DAYS);
      const first = occurrencesBetween(schedule, from > schedule.firstDue ? from : schedule.firstDue, addDays(today, LOOKAHEAD_DAYS)).find((d) => !paid.has(d));
      if (first) due = { date: first, state: dueState(first, today, false, Number(i.remind_days)) };
    }
    const settled = [...paid].sort();
    return {
      id: i.id as string,
      kind,
      name: i.name as string,
      amount: Number(i.amount),
      frequency: schedule.frequency,
      firstDue: schedule.firstDue,
      endsOn: schedule.endsOn,
      status: i.status as RecurringView["status"],
      autoRenews: Boolean(i.auto_renews),
      remindDays: Number(i.remind_days),
      notes: (i.notes as string | null) ?? null,
      accountName: i.account_id ? (accName.get(i.account_id as string) ?? null) : null,
      categoryName: i.category_id ? (catName.get(i.category_id as string) ?? null) : null,
      due,
      monthly: monthlyEquivalent(Number(i.amount), schedule.frequency),
      yearly: yearlyEquivalent(Number(i.amount), schedule.frequency),
      lastSettled: settled.length ? settled[settled.length - 1] : null,
    };
  });
}

/* ───────────── calendar ───────────── */

export type CalendarKind = "bill" | "subscription" | "income" | "goal" | "debt";

export interface CalendarEvent {
  date: string;
  kind: CalendarKind;
  title: string;
  amount: number | null;
  /** actual = already settled/received; scheduled = expected; estimate = derived from entered terms. */
  nature: "actual" | "scheduled" | "estimate";
  state?: DueState;
  href: string;
}

export async function calendarEvents(ctx: Ctx, from: string, to: string): Promise<CalendarEvent[]> {
  const today = todayFor(ctx);
  const [{ data: items }, { data: pays }, { data: goals }, { data: terms }, accounts] = await Promise.all([
    ctx.supabase.from("recurring_items").select("*").eq("space_id", ctx.space.id).eq("status", "active"),
    ctx.supabase.from("recurring_payments").select("item_id,due_date").eq("space_id", ctx.space.id),
    ctx.supabase.from("savings_goals").select("id,name,target_amount,deadline,status").eq("space_id", ctx.space.id).eq("status", "active").not("deadline", "is", null),
    ctx.supabase.from("debt_terms").select("account_id,min_payment,due_day").eq("space_id", ctx.space.id),
    listAccounts(ctx),
  ]);
  const events: CalendarEvent[] = [];
  const paidKey = new Set((pays ?? []).map((p) => `${p.item_id}|${p.due_date}`));
  for (const i of items ?? []) {
    const schedule = { frequency: i.frequency as Frequency, firstDue: i.first_due as string, endsOn: (i.ends_on as string | null) ?? null };
    for (const d of occurrencesBetween(schedule, from, to)) {
      const paid = paidKey.has(`${i.id}|${d}`);
      events.push({
        date: d,
        kind: i.kind as CalendarKind,
        title: i.name as string,
        amount: Number(i.amount),
        nature: paid ? "actual" : "scheduled",
        state: dueState(d, today, paid, Number(i.remind_days)),
        href: i.kind === "bill" ? "/app/bills" : i.kind === "subscription" ? "/app/subscriptions" : "/app/income",
      });
    }
  }
  for (const g of goals ?? []) {
    const d = g.deadline as string;
    if (d >= from && d <= to) events.push({ date: d, kind: "goal", title: `${g.name} deadline`, amount: Number(g.target_amount), nature: "scheduled", href: "/app/goals" });
  }
  const liability = new Map(accounts.filter((a) => isLiability(a.type)).map((a) => [a.id, a]));
  for (const t of terms ?? []) {
    const acct = liability.get(t.account_id as string);
    if (!acct || !t.due_day) continue;
    const dueDay = Number(t.due_day);
    // One payment date per calendar month in the range, clamped to the month's length.
    let [y, m] = from.split("-").map(Number);
    const [ty, tm] = to.split("-").map(Number);
    while (y < ty || (y === ty && m <= tm)) {
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const date = `${y}-${String(m).padStart(2, "0")}-${String(Math.min(dueDay, last)).padStart(2, "0")}`;
      if (date >= from && date <= to) events.push({ date, kind: "debt", title: `${acct.name} payment due`, amount: Number(t.min_payment) || null, nature: "estimate", href: "/app/debt" });
      m++;
      if (m > 12) { m = 1; y++; }
    }
  }
  const seen = new Set<string>();
  return events
    .filter((e) => {
      const k = `${e.kind}|${e.title}|${e.date}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

/* ───────────── debts ───────────── */

export interface DebtView {
  accountId: string;
  name: string;
  owed: number;
  rateBps: number | null;
  minPayment: number | null;
  dueDay: number | null;
}

export async function listDebts(ctx: Ctx): Promise<DebtView[]> {
  const [accounts, { data: terms }] = await Promise.all([listAccounts(ctx), ctx.supabase.from("debt_terms").select("*").eq("space_id", ctx.space.id)]);
  const byAcct = new Map((terms ?? []).map((t) => [t.account_id as string, t]));
  return accounts
    .filter((a) => isLiability(a.type))
    .map((a) => {
      const t = byAcct.get(a.id);
      return {
        accountId: a.id,
        name: a.name,
        owed: a.balance,
        rateBps: t ? Number(t.interest_rate_bps) : null,
        minPayment: t ? Number(t.min_payment) : null,
        dueDay: t?.due_day ? Number(t.due_day) : null,
      };
    });
}
