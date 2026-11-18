/**
 * Unified billing and AI monitoring (migrations 11 and 12). Runs the real migrations in-process.
 * Covers: who can read/write billing rows, idempotent and out-of-order webhook application, payment ranking,
 * the entitlement projection, one open checkout per person, and the admin-only AI usage summary.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const U = (n: number) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const [ALICE, BOB, ADMIN] = [U(1), U(2), U(3)];
let db: PGlite;

async function as<T>(role: "authenticated" | "service_role", uid: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${uid ?? ""}',false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`);
  }
}
const denied = (p: Promise<unknown>) => p.then(() => false, () => true);
const asUser = <T>(uid: string, sql: string) => as("authenticated", uid, async () => (await db.query<T>(sql)).rows);
const asService = <T>(sql: string) => as("service_role", null, async () => (await db.query<T>(sql)).rows);

const apply = (opts: { id: string; type: string; at: string; user?: string | null; sub?: object | null; pay?: object | null; provider?: string }) =>
  asService<{ r: string }>(
    `select budgetbuddy.billing_apply_event('${opts.provider ?? "razorpay"}', '${opts.id}', '${opts.type}', '${opts.at}', ${opts.user ? `'${opts.user}'` : "null"}, ${opts.sub ? `'${JSON.stringify(opts.sub)}'::jsonb` : "null"}, ${opts.pay ? `'${JSON.stringify(opts.pay)}'::jsonb` : "null"}) as r`,
  ).then((rows) => rows[0].r);

const pending = (user: string, subId: string, provider = "razorpay", interval = "month") =>
  asService(`insert into budgetbuddy.billing_subscriptions (user_id, provider, provider_subscription_id, interval, amount_minor, currency) values ('${user}', '${provider}', '${subId}', '${interval}', 14900, 'INR')`);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, service_role; grant execute on function auth.uid() to authenticated, service_role;
    insert into auth.users values ${[ALICE, BOB, ADMIN].map((u) => `('${u}')`).join(",")};
    create schema storage; create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated, anon; grant select, insert, update, delete on storage.objects to authenticated;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
  `);
  const dir = join(process.cwd(), "supabase/migrations");
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(join(dir, f), "utf8"));
  await db.exec(`grant usage on schema budgetbuddy to service_role;`);
  await db.exec(`insert into budgetbuddy.platform_admins values ('${ADMIN}')`);
});

describe("access", () => {
  it("people cannot write billing tables or call the apply function", async () => {
    expect(await denied(asUser(ALICE, `insert into budgetbuddy.billing_subscriptions (user_id, provider, provider_subscription_id, interval, amount_minor, currency, status) values ('${ALICE}','razorpay','sub_x','month',14900,'INR','active')`))).toBe(true);
    expect(await denied(asUser(ALICE, `insert into budgetbuddy.billing_payments (user_id, provider, provider_payment_id, amount_minor, currency, status) values ('${ALICE}','razorpay','pay_x',14900,'INR','captured')`))).toBe(true);
    expect(await denied(asUser(ALICE, `insert into budgetbuddy.entitlements (user_id, plan, status, current_period_end) values ('${ALICE}','pro','active', now() + interval '30 days')`))).toBe(true);
    expect(await denied(asUser(ALICE, `select budgetbuddy.billing_apply_event('razorpay','e1','x', now(), '${ALICE}', null, null)`))).toBe(true);
  });
  it("people read only their own billing rows; admins read all", async () => {
    await pending(ALICE, "sub_alice");
    await pending(BOB, "sub_bob");
    await apply({ id: "ev_a_pay", type: "payment.captured", at: "2026-11-01T00:00:00Z", user: ALICE, sub: null, pay: { provider_payment_id: "pay_alice", provider_subscription_id: "sub_alice", amount_minor: 14900, currency: "INR", status: "captured" } });
    expect((await asUser<{ provider_subscription_id: string }>(ALICE, `select provider_subscription_id from budgetbuddy.billing_subscriptions`)).map((r) => r.provider_subscription_id)).toEqual(["sub_alice"]);
    expect(await asUser(BOB, `select * from budgetbuddy.billing_payments`)).toEqual([]);
    expect((await asUser(ADMIN, `select * from budgetbuddy.billing_subscriptions`)).length).toBe(2);
    expect(await asUser(ALICE, `select * from budgetbuddy.billing_audit where user_id = '${BOB}'`)).toEqual([]);
  });
  it("only one open checkout per person, provider and interval", async () => {
    expect(await denied(pending(ALICE, "sub_alice_second"))).toBe(true);
    await pending(ALICE, "sub_alice_year", "razorpay", "year"); // different interval is fine
    await pending(ALICE, "sub_alice_pp", "paypal"); // different provider is fine
  });
});

describe("applying events", () => {
  it("activation grants the plan, once; a duplicate delivery changes nothing", async () => {
    const ev = { id: "ev_activate", type: "subscription.activated", at: "2026-11-02T10:00:00Z", sub: { provider_subscription_id: "sub_bob", status: "active", current_period_end: "2027-12-02T10:00:00Z" } };
    expect(await apply({ ...ev, user: BOB })).toBe("applied");
    const ent = await asUser<{ plan: string; status: string; provider: string }>(BOB, `select plan, status, provider from budgetbuddy.entitlements`);
    expect(ent).toEqual([{ plan: "pro", status: "active", provider: "razorpay" }]);
    expect(await apply({ ...ev, user: BOB })).toBe("duplicate");
    expect((await asService<{ n: string }>(`select count(*)::text n from budgetbuddy.billing_audit where detail->>'event_id' = 'ev_activate'`))[0].n).toBe("1");
  });
  it("a pending checkout never grants a plan", async () => {
    expect(await asUser(ALICE, `select * from budgetbuddy.entitlements`)).toEqual([]);
  });
  it("an older event cannot overwrite newer state (out-of-order delivery)", async () => {
    await apply({ id: "ev_cancel", type: "subscription.cancelled", at: "2026-11-10T00:00:00Z", user: BOB, sub: { provider_subscription_id: "sub_bob", status: "canceled", canceled_at: "2026-11-10T00:00:00Z" } });
    expect(await apply({ id: "ev_late_charged", type: "subscription.charged", at: "2026-11-05T00:00:00Z", user: BOB, sub: { provider_subscription_id: "sub_bob", status: "active", current_period_end: "2028-01-01T00:00:00Z" } })).toBe("stale");
    const [row] = await asUser<{ status: string; current_period_end: string }>(BOB, `select status, current_period_end::text from budgetbuddy.entitlements`);
    expect(row.status).toBe("canceled");
    expect(row.current_period_end).toContain("2027-12-02"); // the late event's 2028 date was not applied
  });
  it("a payment only moves forward: a late 'failed' does not undo 'captured'", async () => {
    await apply({ id: "ev_cap", type: "payment.captured", at: "2026-11-03T00:00:00Z", user: BOB, pay: { provider_payment_id: "pay_bob1", provider_subscription_id: "sub_bob", amount_minor: 14900, currency: "INR", status: "captured", paid_at: "2026-11-03T00:00:00Z" } });
    await apply({ id: "ev_failed_late", type: "payment.failed", at: "2026-11-02T00:00:00Z", user: BOB, pay: { provider_payment_id: "pay_bob1", provider_subscription_id: "sub_bob", amount_minor: 14900, currency: "INR", status: "failed", failure_reason: "late" } });
    expect((await asUser<{ status: string }>(BOB, `select status from budgetbuddy.billing_payments where provider_payment_id='pay_bob1'`))[0].status).toBe("captured");
    await apply({ id: "ev_refund", type: "refund.processed", at: "2026-11-12T00:00:00Z", user: BOB, pay: { provider_payment_id: "pay_bob1", amount_minor: 14900, currency: "INR", status: "refunded" } });
    expect((await asUser<{ status: string }>(BOB, `select status from budgetbuddy.billing_payments where provider_payment_id='pay_bob1'`))[0].status).toBe("refunded");
  });
  it("a failed renewal marks the subscription past due", async () => {
    await apply({ id: "ev_pastdue", type: "subscription.halted", at: "2026-11-20T00:00:00Z", user: BOB, sub: { provider_subscription_id: "sub_bob", status: "past_due" } });
    expect((await asUser<{ status: string }>(BOB, `select status from budgetbuddy.entitlements`))[0].status).toBe("past_due");
  });
  it("lifecycle: pending, active, renewed, then expired", async () => {
    const sub = (status: string, end: string) => ({ provider_subscription_id: "sub_alice", status, current_period_end: end });
    expect(await asUser(ALICE, `select * from budgetbuddy.entitlements`)).toEqual([]); // pending grants nothing
    await apply({ id: "lc1", type: "subscription.activated", at: "2026-11-01T00:00:00Z", user: ALICE, sub: sub("active", "2026-12-01T00:00:00Z") });
    await apply({ id: "lc2", type: "subscription.charged", at: "2026-12-01T00:00:10Z", user: ALICE, sub: sub("active", "2027-01-01T00:00:00Z") }); // renewal
    let [e] = await asUser<{ status: string; current_period_end: string }>(ALICE, `select status, current_period_end::text from budgetbuddy.entitlements`);
    expect(e).toMatchObject({ status: "active" });
    expect(e.current_period_end).toContain("2027-01-01");
    await apply({ id: "lc3", type: "subscription.completed", at: "2027-01-01T00:00:10Z", user: ALICE, sub: sub("expired", "2027-01-01T00:00:00Z") });
    [e] = await asUser(ALICE, `select status, current_period_end::text from budgetbuddy.entitlements`);
    expect(e.status).toBe("canceled"); // with a past period end, resolveEntitlement lapses this to Free
    expect((await asUser<{ status: string }>(ALICE, `select status from budgetbuddy.billing_subscriptions where provider_subscription_id='sub_alice'`))[0].status).toBe("expired");
  });
  it("events for subscriptions this app never created are recorded but never applied", async () => {
    expect(await apply({ id: "ev_foreign", type: "subscription.activated", at: "2026-11-02T10:00:00Z", user: ALICE, sub: { provider_subscription_id: "sub_not_ours", status: "active", current_period_end: "2030-01-01T00:00:00Z" } })).toBe("unmatched");
    expect((await asService<{ n: string }>(`select count(*)::text n from budgetbuddy.billing_subscriptions where provider_subscription_id='sub_not_ours'`))[0].n).toBe("0");
    const [e] = await asUser<{ current_period_end: string }>(ALICE, `select current_period_end::text from budgetbuddy.entitlements`);
    expect(e.current_period_end).not.toContain("2030"); // the foreign event's far-future date was not applied
  });
  it("a failure rolls the event id back so the provider's retry is processed", async () => {
    expect(await denied(apply({ id: "ev_bad", type: "x", at: "2026-11-02T10:00:00Z", user: ALICE, provider: "stripe" }))).toBe(true);
    expect((await asService<{ n: string }>(`select count(*)::text n from budgetbuddy.payment_events where event_id='ev_bad'`))[0].n).toBe("0");
  });
  it("the same event id from two providers is two different events", async () => {
    await pending(ALICE, "I-PAYPAL1", "paypal", "month").catch(() => undefined);
    expect(await apply({ id: "shared", type: "t", at: "2026-11-02T00:00:00Z", user: ALICE, provider: "razorpay" })).toBe("applied");
    expect(await apply({ id: "shared", type: "t", at: "2026-11-02T00:00:00Z", user: ALICE, provider: "paypal" })).toBe("applied");
  });
});

describe("AI monitoring", () => {
  it("ai_settle records the new details and still accepts the old arguments", async () => {
    const [{ r }] = await asUser<{ r: { allowed: boolean; id: number } }>(ALICE, `select budgetbuddy.ai_reserve(20, 60000) as r`);
    await asUser(ALICE, `select budgetbuddy.ai_settle(${r.id}, 'error', 'gemini', 'm', 0, 0, 900, 'rate_limit', 2, 1, 1)`);
    const [{ r: r2 }] = await asUser<{ r: { id: number } }>(ALICE, `select budgetbuddy.ai_reserve(20, 60000) as r`);
    await asUser(ALICE, `select budgetbuddy.ai_settle(${r2.id}, 'ok', 'groq', 'm2', 50, 20, 400)`);
    const rows = await asUser<{ status: string; error_kind: string | null; fallbacks: number }>(ALICE, `select status, error_kind, fallbacks from budgetbuddy.ai_usage order by id`);
    expect(rows).toEqual([{ status: "error", error_kind: "rate_limit", fallbacks: 1 }, { status: "ok", error_kind: null, fallbacks: 0 }]);
  });
  it("the usage summary is for admins only and returns aggregates, never individual rows", async () => {
    expect(await denied(asUser(ALICE, `select budgetbuddy.ai_usage_summary(7)`))).toBe(true);
    const [{ s }] = await asUser<{ s: { totals: { requests: number; ok: number; failed: number; rate_limited: number }; errors: { error_kind: string }[]; by_provider_model: unknown[] } }>(ADMIN, `select budgetbuddy.ai_usage_summary(7) as s`);
    expect(s.totals).toMatchObject({ requests: 2, ok: 1, failed: 1, rate_limited: 1 });
    expect(s.errors[0].error_kind).toBe("rate_limit");
    expect(JSON.stringify(s)).not.toContain(ALICE);
  });
  it("platform_admins cannot be read or written by people", async () => {
    expect(await denied(asUser(ALICE, `select * from budgetbuddy.platform_admins`))).toBe(true);
    expect(await denied(asUser(ALICE, `insert into budgetbuddy.platform_admins values ('${ALICE}')`))).toBe(true);
    expect((await asUser<{ b: boolean }>(ADMIN, `select budgetbuddy.is_platform_admin() as b`))[0].b).toBe(true);
    expect((await asUser<{ b: boolean }>(ALICE, `select budgetbuddy.is_platform_admin() as b`))[0].b).toBe(false);
  });
});
