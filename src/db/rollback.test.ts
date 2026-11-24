/**
 * Rollback and recovery for migrations 11 to 19. Applies everything, puts data in, runs the down scripts in the
 * documented order (19, 18, 17, 16, 15, 14, 13, 12, then 11), checks the previous behaviour is back, then re-applies them forward.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const MIGRATIONS = readdirSync(join(root, "supabase/migrations")).sort();
const M11 = MIGRATIONS.find((f) => f.startsWith("20261118000011"))!;
const M12 = MIGRATIONS.find((f) => f.startsWith("20261118000012"))!;
const M13 = MIGRATIONS.find((f) => f.startsWith("20261122000013"))!;
const M14 = MIGRATIONS.find((f) => f.startsWith("20261123000014"))!;
const M15 = MIGRATIONS.find((f) => f.startsWith("20261123000015"))!;
const M16 = MIGRATIONS.find((f) => f.startsWith("20261124000016"))!;
const M17 = MIGRATIONS.find((f) => f.startsWith("20261124000017"))!;
const M18 = MIGRATIONS.find((f) => f.startsWith("20261124000018"))!;
const M19 = MIGRATIONS.find((f) => f.startsWith("20261125000019"))!;
const USER = randomUUID();
let db: PGlite;

const exists = async (sql: string) => ((await db.query<{ n: number }>(`select count(*)::int n from (${sql}) x`)).rows[0].n) > 0;
const asUser = async <T>(fn: () => Promise<T>) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${USER}',false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`);
  }
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, service_role; grant execute on function auth.uid() to authenticated, service_role;
    insert into auth.users values ('${USER}');
    create schema storage; create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated, anon; grant select, insert, update, delete on storage.objects to authenticated;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
  `);
  for (const f of MIGRATIONS) await db.exec(read(`supabase/migrations/${f}`));
  await db.exec(`grant usage on schema budgetbuddy to service_role;`);
});

describe("rollback and recovery of migrations 11 and 12", () => {
  it("applies cleanly on top of migrations 1 to 10, and 11 to 19 are the last nine", () => {
    expect(MIGRATIONS.slice(-9)).toEqual([M11, M12, M13, M14, M15, M16, M17, M18, M19]);
  });

  it("rolls back 12, then 11, leaving the earlier schema as it was", async () => {
    await db.exec(`insert into budgetbuddy.billing_subscriptions (user_id, provider, provider_subscription_id, interval, amount_minor, currency) values ('${USER}','razorpay','sub_rb','month',14900,'INR')`);
    await db.exec(read("supabase/rollback/20261125000019_finn_rolling_limits_down.sql"));
    expect(await exists(`select 1 from pg_proc where proname in ('ai_reserve_window','ai_quota_window')`)).toBe(false);
    expect(await exists(`select 1 from information_schema.columns where table_name='ai_usage' and column_name='kind'`)).toBe(false);
    await db.exec(read("supabase/rollback/20261124000018_finn_answer_cache_down.sql"));
    expect(await exists(`select 1 from pg_class where relname = 'finn_answer_cache'`)).toBe(false);
    await db.exec(read("supabase/rollback/20261124000017_finn_service_grants_down.sql"));
    await db.exec(read("supabase/rollback/20261124000016_finn_recap_whatsapp_review_down.sql"));
    expect(await exists(`select 1 from pg_class where relname in ('finn_prefs','whatsapp_links','whatsapp_seen')`)).toBe(false);
    expect(await exists(`select 1 from pg_proc where proname = 'finn_whatsapp_start'`)).toBe(false);
    await db.exec(read("supabase/rollback/20261123000015_finn_feedback_down.sql"));
    await db.exec(read("supabase/rollback/20261123000014_finn_history_and_quotas_down.sql"));
    expect(await exists(`select 1 from pg_class where relname in ('finn_conversations','finn_messages')`)).toBe(false);
    expect(await exists(`select 1 from pg_proc where proname in ('ai_reserve_plan','ai_quota')`)).toBe(false);
    await db.exec(read("supabase/rollback/20261122000013_billing_coupons_down.sql"));
    expect(await exists(`select 1 from pg_class where relname in ('billing_coupons','billing_coupon_redemptions')`)).toBe(false);
    expect(await exists(`select 1 from information_schema.columns where table_name='billing_subscriptions' and column_name in ('trial_days','plan_ref','coupon_id')`)).toBe(false);
    await db.exec(read("supabase/rollback/20261118000012_unified_billing_down.sql"));
    for (const t of ["billing_subscriptions", "billing_payments", "billing_audit"]) expect(await exists(`select 1 from pg_class where relname='${t}'`)).toBe(false);
    for (const f of ["billing_apply_event", "billing_sweep_expired", "billing_current_plan", "billing_project_entitlement"]) expect(await exists(`select 1 from pg_proc where proname='${f}'`)).toBe(false);
    expect(await exists(`select 1 from pg_constraint where conname='entitlements_paid_needs_period'`)).toBe(false);
    expect(await exists(`select 1 from information_schema.columns where table_name='payment_events' and column_name in ('event_type','outcome')`)).toBe(false);
    // migration 9's tables are untouched by the rollback of 12
    expect(await exists(`select 1 from pg_class where relname in ('entitlements','payment_events')`)).toBe(true);

    await db.exec(read("supabase/rollback/20261118000011_ai_monitoring_and_platform_admin_down.sql"));
    expect(await exists(`select 1 from pg_class where relname='platform_admins'`)).toBe(false);
    expect(await exists(`select 1 from pg_proc where proname in ('is_platform_admin','ai_usage_summary')`)).toBe(false);
    expect(await exists(`select 1 from information_schema.columns where table_name='ai_usage' and column_name in ('error_kind','attempts','fallbacks','rate_limited')`)).toBe(false);
    // the original 7-argument ai_settle is back and works, so older application code keeps running
    const [{ ok }] = await asUser(async () => {
      const r = await db.query<{ r: { id: number } }>(`select budgetbuddy.ai_reserve(20, 60000) as r`);
      await db.query(`select budgetbuddy.ai_settle(${r.rows[0].r.id}, 'ok', 'groq', 'm', 10, 5, 100)`);
      return (await db.query<{ ok: boolean }>(`select status = 'ok' as ok from budgetbuddy.ai_usage order by id desc limit 1`)).rows;
    });
    expect(ok).toBe(true);
    expect(await exists(`select 1 from pg_proc where proname='ai_settle' and pronargs = 11`)).toBe(false);
  });

  it("recovers: re-applying 11 then 12 works on the rolled-back database, and billing works again", async () => {
    await db.exec(read(`supabase/migrations/${M11}`));
    await db.exec(read(`supabase/migrations/${M12}`));
    await db.exec(read(`supabase/migrations/${M13}`));
    await db.exec(read(`supabase/migrations/${M14}`));
    await db.exec(read(`supabase/migrations/${M15}`));
    await db.exec(read(`supabase/migrations/${M16}`));
    await db.exec(read(`supabase/migrations/${M17}`));
    await db.exec(read(`supabase/migrations/${M18}`));
    await db.exec(read(`supabase/migrations/${M19}`));
    await db.exec(`grant usage on schema budgetbuddy to service_role;`);
    await db.exec(`insert into budgetbuddy.billing_subscriptions (user_id, provider, provider_subscription_id, interval, amount_minor, currency) values ('${USER}','razorpay','sub_again','month',14900,'INR')`);
    await db.exec(`set role service_role`);
    const r = await db.query<{ r: string }>(`select budgetbuddy.billing_apply_event('razorpay','after-recovery','t', now(), null, '{"provider_subscription_id":"sub_again","status":"active","current_period_end":"${new Date(Date.now() + 30 * 864e5).toISOString()}"}'::jsonb, null) as r`);
    await db.exec(`reset role`);
    expect(r.rows[0].r).toBe("applied");
    expect(await asUser(async () => (await db.query<{ p: string }>(`select budgetbuddy.billing_current_plan() as p`)).rows[0].p)).toBe("pro");
  });
});
