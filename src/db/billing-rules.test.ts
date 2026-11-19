/**
 * The access rules of migration 12, one scenario per rule, each on its own fresh person so no test depends on another.
 * Runs the real migrations in-process. See the header of 20261118000012_unified_billing.sql for the rule numbers.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

let db: PGlite;
let n = 0;
const day = (d: number) => new Date(Date.now() + d * 864e5).toISOString();

async function as<T>(role: "authenticated" | "service_role", uid: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${uid ?? ""}',false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`);
  }
}
const svc = <T>(sql: string) => as("service_role", null, async () => (await db.query<T>(sql)).rows);
const usr = <T>(uid: string, sql: string) => as("authenticated", uid, async () => (await db.query<T>(sql)).rows);
const denied = (p: Promise<unknown>) => p.then(() => false, () => true);
const lit = (o: unknown) => (o == null ? "null" : `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`);

let seq = 0;
const apply = (a: { user?: string | null; id?: string; type?: string; at?: string; sub?: object | null; pay?: object | object[] | null; provider?: string }) =>
  svc<{ r: string }>(`select budgetbuddy.billing_apply_event('${a.provider ?? "razorpay"}', '${a.id ?? `e${++seq}`}', '${a.type ?? "t"}', '${a.at ?? new Date(Date.now() + ++seq * 1000).toISOString()}', ${a.user ? `'${a.user}'` : "null"}, ${lit(a.sub)}, ${lit(a.pay)}) as r`).then((r) => r[0].r);

/** A new person with a pending checkout, ready for events. */
async function person(provider = "razorpay") {
  const uid = randomUUID();
  const sid = `sub_${++n}_${uid.slice(0, 6)}`;
  await db.exec(`insert into auth.users values ('${uid}')`);
  await svc(`insert into budgetbuddy.billing_subscriptions (user_id, provider, provider_subscription_id, interval, amount_minor, currency) values ('${uid}','${provider}','${sid}','month',14900,'INR')`);
  const sub = (status: string, end?: string | null, extra: object = {}) => ({ provider_subscription_id: sid, status, ...(end === undefined ? {} : { current_period_end: end }), ...extra });
  const pay = (id: string, status: string, extra: object = {}) => ({ provider_payment_id: id, provider_subscription_id: sid, amount_minor: 14900, currency: "INR", status, ...extra });
  const ent = async () => (await usr<{ status: string; current_period_end: string | null }>(uid, `select status, current_period_end::text from budgetbuddy.entitlements`))[0];
  const plan = async () => (await usr<{ p: string }>(uid, `select budgetbuddy.billing_current_plan() as p`))[0].p;
  const subRow = async () => (await svc<{ status: string; current_period_end: string | null }>(`select status, current_period_end::text from budgetbuddy.billing_subscriptions where provider_subscription_id='${sid}'`))[0];
  const ledger = async () => svc<{ provider_payment_id: string; status: string; amount_minor: string; currency: string }>(`select provider_payment_id, status, amount_minor::text, currency from budgetbuddy.billing_payments where subscription_id = (select id from budgetbuddy.billing_subscriptions where provider_subscription_id='${sid}') order by provider_payment_id`);
  return { uid, sid, sub, pay, ent, plan, subRow, ledger };
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, service_role; grant execute on function auth.uid() to authenticated, service_role;
    create schema storage; create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated, anon; grant select, insert, update, delete on storage.objects to authenticated;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
  `);
  const dir = join(process.cwd(), "supabase/migrations");
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(join(dir, f), "utf8"));
  await db.exec(`grant usage on schema budgetbuddy to service_role;`);
});

describe("rule 1: pending or incomplete payments never grant Pro", () => {
  it("a pending subscription, even with a future date and a captured payment, grants nothing", async () => {
    const p = await person();
    await apply({ user: p.uid, sub: p.sub("pending", day(30)), pay: p.pay("pay_a", "captured", { paid_at: day(0) }) });
    expect(await p.ent()).toBeUndefined();
    expect(await p.plan()).toBe("free");
  });
  it("a payment on its own (no subscription change) grants nothing", async () => {
    const p = await person();
    await apply({ user: p.uid, pay: p.pay("pay_b", "captured", { paid_at: day(0) }) });
    expect(await p.ent()).toBeUndefined();
  });
  it("an authorised or failed first payment grants nothing", async () => {
    const p = await person();
    await apply({ user: p.uid, sub: p.sub("pending", null), pay: [p.pay("pay_c", "authorized"), p.pay("pay_d", "failed", { failure_reason: "declined" })] });
    expect(await p.ent()).toBeUndefined();
    expect((await p.ledger()).map((r) => r.status)).toEqual(["authorized", "failed"]);
  });
});

describe("rule 2: active needs a valid paid-through date", () => {
  it("an 'active' event without a date is refused: the subscription stays pending and nothing is granted", async () => {
    const p = await person();
    await apply({ user: p.uid, sub: p.sub("active") });
    expect((await p.subRow()).status).toBe("pending");
    expect(await p.ent()).toBeUndefined();
  });
  it("the table itself refuses active without a date, and entitlements refuses an active row without one", async () => {
    const p = await person();
    expect(await denied(svc(`update budgetbuddy.billing_subscriptions set status='active', current_period_end=null where provider_subscription_id='${p.sid}'`))).toBe(true);
    expect(await denied(svc(`insert into budgetbuddy.entitlements (user_id, plan, status, current_period_end) values ('${p.uid}','pro','active',null)`))).toBe(true);
    expect(await denied(svc(`insert into budgetbuddy.entitlements (user_id, plan, status, current_period_end) values ('${p.uid}','pro','trialing',null)`))).toBe(true);
    await svc(`insert into budgetbuddy.entitlements (user_id, plan, status, current_period_end) values ('${p.uid}','pro','canceled',null)`); // allowed, and resolves to Free
    expect(await p.plan()).toBe("free");
  });
  it("an expired date: 'active' with a past end is projected as past due, not active", async () => {
    const p = await person();
    await apply({ user: p.uid, sub: p.sub("active", day(-3)) });
    expect((await p.ent()).status).toBe("past_due");
    expect(await p.plan()).toBe("pro"); // seven-day grace
  });
  it("past the grace period the plan is Free even though the row still says past due", async () => {
    const p = await person();
    await apply({ user: p.uid, sub: p.sub("active", day(-10)) });
    expect((await p.ent()).status).toBe("past_due");
    expect(await p.plan()).toBe("free");
  });
});

describe("rule 4: cancellation keeps paid access to the real period end", () => {
  it("access continues to the stored end, not to 'now' and not beyond", async () => {
    const p = await person();
    await apply({ user: p.uid, sub: p.sub("active", day(20)), pay: p.pay("pay_1", "captured", { paid_at: day(-10) }) });
    expect(await p.plan()).toBe("pro");
    await apply({ user: p.uid, sub: { provider_subscription_id: p.sid, status: "canceled", canceled_at: day(0), cancel_at_period_end: true } }); // no end in the event
    const e = await p.ent();
    expect(e.status).toBe("canceled");
    expect(new Date(e.current_period_end!).getTime()).toBeGreaterThan(Date.now() + 19 * 864e5);
    expect(new Date(e.current_period_end!).getTime()).toBeLessThan(Date.now() + 21 * 864e5);
    expect(await p.plan()).toBe("pro");
  });
  it("once that end passes the plan is Free", async () => {
    const p = await person();
    await apply({ user: p.uid, sub: p.sub("canceled", day(-1)), pay: p.pay("pay_2", "captured", { paid_at: day(-31) }) });
    expect(await p.plan()).toBe("free");
  });
  it("a subscription cancelled before it was ever paid grants nothing", async () => {
    const p = await person();
    await apply({ user: p.uid, sub: p.sub("canceled") });
    expect(await p.plan()).toBe("free");
  });
});

describe("rule 5: expired subscriptions cannot stay entitled", () => {
  it("an expired subscription ends access at once, even if the provider's date is in the future", async () => {
    const p = await person();
    await apply({ user: p.uid, sub: p.sub("active", day(20)) });
    await apply({ user: p.uid, sub: p.sub("expired", day(20)) });
    expect(await p.plan()).toBe("free");
    expect(new Date((await p.ent()).current_period_end!).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });
  it("the daily sweep moves overdue subscriptions along and is safe to repeat", async () => {
    await svc(`select budgetbuddy.billing_sweep_expired()`); // the sweep is global: settle what earlier scenarios left overdue
    await svc(`select budgetbuddy.billing_sweep_expired()`);
    const overdue = await person();
    const longGone = await person();
    const cancelled = await person();
    const fine = await person();
    await apply({ user: overdue.uid, sub: overdue.sub("active", day(5)) });
    await apply({ user: longGone.uid, sub: longGone.sub("past_due", day(-3)) });
    await apply({ user: cancelled.uid, sub: cancelled.sub("canceled", day(3)) });
    await apply({ user: fine.uid, sub: fine.sub("active", day(15)) });
    // time passes: move each period end into the past, as the clock would
    await svc(`update budgetbuddy.billing_subscriptions set current_period_end = now() - interval '2 hours' where provider_subscription_id = '${overdue.sid}'`);
    await svc(`update budgetbuddy.billing_subscriptions set current_period_end = now() - interval '9 days' where provider_subscription_id = '${longGone.sid}'`);
    await svc(`update budgetbuddy.billing_subscriptions set current_period_end = now() - interval '1 day' where provider_subscription_id = '${cancelled.sid}'`);
    const [{ c }] = await svc<{ c: number }>(`select budgetbuddy.billing_sweep_expired() as c`);
    expect(c).toBe(3);
    expect((await overdue.subRow()).status).toBe("past_due");
    expect((await longGone.subRow()).status).toBe("expired");
    expect((await cancelled.subRow()).status).toBe("expired");
    expect((await fine.subRow()).status).toBe("active");
    expect(await fine.plan()).toBe("pro");
    expect(await longGone.plan()).toBe("free");
    const [{ c: again }] = await svc<{ c: number }>(`select budgetbuddy.billing_sweep_expired() as c`);
    expect(again).toBe(0);
  });
});

describe("rule 6: refunds", () => {
  it("a partial refund keeps access; a full refund of the latest payment ends it; a newer paid renewal restores it", async () => {
    const p = await person();
    await apply({ user: p.uid, sub: p.sub("active", day(20)), pay: p.pay("pay_r1", "captured", { paid_at: day(-1) }) });
    expect(await p.plan()).toBe("pro");
    await apply({ user: null, pay: { provider_payment_id: "pay_r1", amount_minor: 14900, currency: "INR", status: "partially_refunded" } }); // found by payment id alone
    expect(await p.plan()).toBe("pro");
    await apply({ user: null, pay: { provider_payment_id: "pay_r1", amount_minor: 14900, currency: "INR", status: "refunded" } });
    expect(await p.plan()).toBe("free");
    expect((await p.ent()).status).toBe("canceled");
    expect((await p.ledger())[0].status).toBe("refunded");
    const audit = await svc<{ action: string }>(`select action from budgetbuddy.billing_audit where user_id='${p.uid}' and action='payment_refunded'`);
    expect(audit).toHaveLength(1);
    await apply({ user: p.uid, sub: p.sub("active", day(50)), pay: p.pay("pay_r2", "captured", { paid_at: day(0) }) });
    expect(await p.plan()).toBe("pro");
  });
  it("a refund that arrives before the original payment is known is recorded as unmatched, not applied", async () => {
    expect(await apply({ user: null, pay: { provider_payment_id: "pay_never_seen", amount_minor: 1, currency: "INR", status: "refunded" } })).toBe("unmatched");
  });
  it("refund events are idempotent and cannot be undone by a late 'captured'", async () => {
    const p = await person();
    await apply({ user: p.uid, sub: p.sub("active", day(20)), pay: p.pay("pay_x", "captured", { paid_at: day(-1) }) });
    const refund = { id: "refund-evt-1", user: null, pay: { provider_payment_id: "pay_x", amount_minor: 14900, currency: "INR", status: "refunded" } };
    expect(await apply(refund)).toBe("applied");
    expect(await apply(refund)).toBe("duplicate");
    await apply({ user: p.uid, pay: p.pay("pay_x", "captured", { paid_at: day(-1) }) }); // out of order: captured arrives after refunded
    expect((await p.ledger())[0].status).toBe("refunded");
    expect(await p.plan()).toBe("free");
  });
});

describe("failed renewals in the ledger", () => {
  it("a failed renewal creates one failed ledger row (amount and currency from the subscription) and marks it past due", async () => {
    const p = await person();
    await apply({ user: p.uid, sub: p.sub("active", day(2)), pay: p.pay("pay_ok", "captured", { paid_at: day(-28) }) });
    const failed = { provider_payment_id: `renewal_failed:${p.sid}:1`, provider_subscription_id: p.sid, status: "failed", failure_reason: "Renewal payment failed" };
    await apply({ user: null, sub: p.sub("past_due"), pay: failed });
    await apply({ user: null, sub: p.sub("past_due"), pay: failed }); // retry of the same failure, different event id
    const rows = await p.ledger();
    expect(rows.filter((r) => r.status === "failed")).toEqual([{ provider_payment_id: `renewal_failed:${p.sid}:1`, status: "failed", amount_minor: "14900", currency: "INR" }]);
    expect((await p.ent()).status).toBe("past_due");
  });
  it("when the retry succeeds the failure stays on record and the plan is active again", async () => {
    const p = await person();
    await apply({ user: p.uid, sub: p.sub("past_due", day(-1)), pay: { provider_payment_id: `renewal_failed:${p.sid}:1`, provider_subscription_id: p.sid, status: "failed" } });
    await apply({ user: p.uid, sub: p.sub("active", day(30)), pay: p.pay("pay_renewed", "captured", { paid_at: day(0) }) });
    expect((await p.ledger()).map((r) => r.status).sort()).toEqual(["captured", "failed"]);
    expect((await p.ent()).status).toBe("active");
  });
  it("several payments in one event are all recorded, once", async () => {
    const p = await person("paypal");
    const batch = [p.pay("t1", "captured", { paid_at: day(-60) }), p.pay("t2", "failed"), p.pay("t3", "captured", { paid_at: day(-30) })];
    await apply({ user: p.uid, provider: "paypal", sub: p.sub("active", day(2)), pay: batch, id: "batch-1" });
    expect(await apply({ user: p.uid, provider: "paypal", sub: p.sub("active", day(2)), pay: batch, id: "batch-1" })).toBe("duplicate");
    await apply({ user: p.uid, provider: "paypal", sub: p.sub("active", day(2)), pay: batch, id: "batch-2" }); // a fresh sync of the same transactions
    expect((await p.ledger()).map((r) => `${r.provider_payment_id}:${r.status}`)).toEqual(["t1:captured", "t2:failed", "t3:captured"]);
  });
});

describe("rule 7: no regression", () => {
  it("a later 'pending' event cannot take an active subscription back to pending or remove access", async () => {
    const p = await person();
    await apply({ user: p.uid, sub: p.sub("active", day(20)) });
    await apply({ user: p.uid, sub: p.sub("pending") });
    expect((await p.subRow()).status).toBe("active");
    expect(await p.plan()).toBe("pro");
  });
  it("an older event never overwrites a newer one, but its payments are still recorded", async () => {
    const p = await person();
    await apply({ user: p.uid, at: day(0), sub: p.sub("canceled", day(5)) });
    expect(await apply({ user: p.uid, at: day(-2), sub: p.sub("active", day(90)), pay: p.pay("pay_old", "captured", { paid_at: day(-2) }) })).toBe("stale");
    expect((await p.subRow()).status).toBe("canceled");
    expect((await p.ledger()).map((r) => r.provider_payment_id)).toEqual(["pay_old"]);
  });
  it("a different subscription cannot overwrite an entitlement that is still paid up", async () => {
    const p = await person();
    await apply({ user: p.uid, sub: p.sub("active", day(30)) });
    await svc(`insert into budgetbuddy.billing_subscriptions (user_id, provider, provider_subscription_id, interval, amount_minor, currency) values ('${p.uid}','paypal','I-OTHER','month',200,'USD')`);
    await apply({ user: p.uid, provider: "paypal", sub: { provider_subscription_id: "I-OTHER", status: "canceled" } });
    expect((await usr<{ provider: string }>(p.uid, `select provider from budgetbuddy.entitlements`))[0].provider).toBe("razorpay");
  });
});

describe("isolation, shared-database safety and retention", () => {
  it("one person cannot read another's subscription, payments, audit or entitlement", async () => {
    const a = await person();
    const b = await person();
    await apply({ user: a.uid, sub: a.sub("active", day(20)), pay: a.pay("pay_iso", "captured", { paid_at: day(0) }) });
    for (const t of ["billing_subscriptions", "billing_payments", "billing_audit", "entitlements"]) {
      expect(await usr(b.uid, `select * from budgetbuddy.${t} where user_id = '${a.uid}'`)).toEqual([]);
    }
    expect((await usr<{ p: string }>(b.uid, `select budgetbuddy.billing_current_plan() as p`))[0].p).toBe("free");
    expect(await denied(usr(b.uid, `update budgetbuddy.billing_payments set status='refunded'`))).toBe(true);
    expect(await denied(usr(b.uid, `delete from budgetbuddy.billing_subscriptions`))).toBe(true);
  });
  it("admin access is restricted to the platform_admins list, which people cannot edit", async () => {
    const a = await person();
    const admin = randomUUID();
    await db.exec(`insert into auth.users values ('${admin}')`);
    await apply({ user: a.uid, sub: a.sub("active", day(20)) });
    expect(await usr(admin, `select * from budgetbuddy.billing_subscriptions`)).toEqual([]); // not an admin yet
    expect(await denied(usr(admin, `insert into budgetbuddy.platform_admins values ('${admin}')`))).toBe(true);
    await db.exec(`insert into budgetbuddy.platform_admins values ('${admin}')`); // the owner does this by hand
    expect((await usr(admin, `select * from budgetbuddy.billing_subscriptions`)).length).toBeGreaterThan(0);
    expect(await denied(usr(admin, `delete from budgetbuddy.billing_payments`))).toBe(true); // admins read; they do not write
  });
  it("every new object lives in the budgetbuddy schema only", async () => {
    const rows = await db.query<{ nspname: string; relname: string }>(`select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relname in ('billing_subscriptions','billing_payments','billing_audit','platform_admins')`);
    expect(new Set(rows.rows.map((r) => r.nspname))).toEqual(new Set(["budgetbuddy"]));
    const fns = await db.query<{ nspname: string }>(`select n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('billing_apply_event','billing_project_entitlement','billing_sweep_expired','billing_current_plan','is_platform_admin','ai_usage_summary')`);
    expect(new Set(fns.rows.map((r) => r.nspname))).toEqual(new Set(["budgetbuddy"]));
  });
  it("deleting a sign-in identity (for example from another product in the shared auth project) keeps the billing records", async () => {
    const p = await person();
    await apply({ user: p.uid, sub: p.sub("active", day(20)), pay: p.pay("pay_keep", "captured", { paid_at: day(0) }) });
    await db.exec(`delete from budgetbuddy.entitlements where user_id='${p.uid}'; delete from auth.users where id='${p.uid}'`);
    const subs = await svc<{ user_id: string | null }>(`select user_id from budgetbuddy.billing_subscriptions where provider_subscription_id='${p.sid}'`);
    expect(subs).toEqual([{ user_id: null }]);
    expect((await svc(`select 1 from budgetbuddy.billing_payments where provider_payment_id='pay_keep'`)).length).toBe(1);
  });
  it("the functions are not callable by people or anonymous visitors", async () => {
    const p = await person();
    for (const call of [`billing_apply_event('razorpay','x','t',now(),null,null,null)`, `billing_sweep_expired()`, `billing_project_entitlement(gen_random_uuid())`]) {
      expect(await denied(usr(p.uid, `select budgetbuddy.${call}`))).toBe(true);
    }
  });
});
