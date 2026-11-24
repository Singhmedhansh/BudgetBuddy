/** Migration 13: coupons and trial bookkeeping. Runs the real migrations in-process. */
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
  await db.exec(`insert into budgetbuddy.billing_coupons (code, campaign, kind, trial_days, paypal_plan_ids, max_redemptions) values ('INSTA30', 'instagram', 'trial_days', 30, '{"month":"P-M30"}', 2)`);
});

describe("coupon tables", () => {
  it("people cannot read, guess or write coupons; platform admins can read them", async () => {
    expect((await asUser<{ n: number }>(ALICE, `select count(*)::int n from budgetbuddy.billing_coupons`))[0].n).toBe(0);
    expect(await denied(asUser(ALICE, `insert into budgetbuddy.billing_coupons (code, kind, trial_days) values ('FREE', 'trial_days', 99)`))).toBe(true);
    expect(await denied(asUser(ALICE, `update budgetbuddy.billing_coupons set trial_days = 365`))).toBe(true);
    expect((await asUser<{ n: number }>(ADMIN, `select count(*)::int n from budgetbuddy.billing_coupons`))[0].n).toBe(1);
    expect(await denied(asUser(ALICE, `select budgetbuddy.billing_redeem_for_subscription('razorpay','x')`))).toBe(true);
  });
  it("enforces the shape of a code, unique codes, and a trial coupon needing its days", async () => {
    expect(await denied(asService(`insert into budgetbuddy.billing_coupons (code, kind, trial_days) values ('bad code', 'trial_days', 5)`))).toBe(true);
    expect(await denied(asService(`insert into budgetbuddy.billing_coupons (code, kind) values ('NODAYS', 'trial_days')`))).toBe(true);
    expect(await denied(asService(`insert into budgetbuddy.billing_coupons (code, kind, trial_days) values ('INSTA30', 'trial_days', 5)`))).toBe(true);
    expect(await denied(asService(`insert into budgetbuddy.billing_coupons (code, kind, trial_days, intervals) values ('WEIRD', 'trial_days', 5, array['week'])`))).toBe(true);
  });
});

describe("redeeming for a subscription that started", () => {
  const sub = (user: string, id: string, status: string) =>
    asService(`insert into budgetbuddy.billing_subscriptions (user_id, provider, provider_subscription_id, interval, amount_minor, currency, status, trial_days, plan_ref, coupon_id, current_period_end)
      values ('${user}', 'paypal', '${id}', 'month', 299, 'USD', '${status}', 30, 'P-M30', (select id from budgetbuddy.billing_coupons where code = 'INSTA30'), ${status === "active" ? "now() + interval '30 days'" : "null"})`);
  const redeemed = async () => (await asService<{ n: number }>(`select redeemed_count n from budgetbuddy.billing_coupons where code = 'INSTA30'`))[0].n;
  const redeem = (id: string) => asService<{ r: boolean }>(`select budgetbuddy.billing_redeem_for_subscription('paypal', '${id}') as r`).then((r) => r[0].r);

  it("a checkout that never started does not use the code up", async () => {
    await sub(ALICE, "I-PEND", "pending");
    expect(await redeem("I-PEND")).toBe(false);
    expect(await redeemed()).toBe(0);
  });
  it("counts once when the subscription starts, however many times it is reported", async () => {
    await sub(BOB, "I-BOB", "active");
    expect(await redeem("I-BOB")).toBe(true);
    expect(await redeem("I-BOB")).toBe(false);
    expect(await redeem("I-BOB")).toBe(false);
    expect(await redeemed()).toBe(1);
    expect((await asService<{ n: number }>(`select count(*)::int n from budgetbuddy.billing_coupon_redemptions`))[0].n).toBe(1);
  });
  it("one person can use a code once", async () => {
    await sub(BOB, "I-BOB2", "active");
    expect(await redeem("I-BOB2")).toBe(false);
    expect(await redeemed()).toBe(1);
  });
  it("an unknown subscription redeems nothing", async () => {
    expect(await redeem("I-NOPE")).toBe(false);
  });
});
