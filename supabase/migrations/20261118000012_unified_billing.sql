-- Migration 12: one provider-independent billing system for Razorpay and PayPal.
--
-- Existing from migration 9 and kept as it is: `entitlements` (the one row the rest of the app reads to decide the
-- plan) and `payment_events` (webhook idempotency). They are extended, not duplicated. Every object here lives in the
-- `budgetbuddy` schema; nothing in `public` (HireCheck) or `auth` is altered. The only coupling to the shared project
-- is foreign keys to auth.users, which are deliberately NOT cascading deletes (see "retention" below).
--
-- New:
--   billing_subscriptions  one row per provider subscription. Created as 'pending' when checkout starts, so the amount,
--                          currency and interval the server expects are on record BEFORE anything is paid, and a
--                          payment can be checked against them. Never against a price sent by the browser.
--   billing_payments       the payment ledger: one row per provider payment (including failed renewals and refunds),
--                          with a rank so a late event can never move a payment backwards.
--   billing_audit          append-only history of every billing decision (no secrets, no card data).
--
-- THE ACCESS RULES (all enforced here, in one place, by billing_project_entitlement):
--   1. Only a subscription that has left 'pending' can grant anything. A pending or incomplete checkout never does.
--   2. 'active' needs a paid-through date. Without one the subscription is not granted (and the status is refused).
--   3. 'active' with a date already in the past is projected as 'past_due' (seven-day grace in the app), not 'active'.
--   4. 'canceled' keeps access to the stored paid-through date, never to "now" and never beyond it.
--   5. 'expired' ends access immediately (period end is capped at now()).
--   6. If the person's most recent paid payment is fully refunded, access ends immediately. A partial refund does not.
--      A later paid renewal supersedes the refund and restores access.
--   7. Status never regresses to 'pending' once it has left it, and an older event never overwrites a newer one.
--   8. entitlements itself refuses an active/trialing row without a paid-through date (CHECK, below).
--
-- Writes happen only through billing_apply_event(), callable by the service role alone. It records the webhook event
-- id, applies the change and projects the entitlement in ONE transaction: a failure rolls the event id back too, so
-- the provider's retry is processed, and a duplicate delivery is a no-op.
--
-- RLS: people read only their own billing rows; platform admins (migration 11) read all. Nobody can write from the
-- app.
--
-- Retention: billing rows are financial records. They reference auth.users with ON DELETE SET NULL (never CASCADE), so
-- removing a sign-in identity, including from another product that shares this auth project, cannot erase them.
-- They are NOT removed by delete_my_data(); how long to keep them is an owner decision to confirm with the privacy
-- policy.
--
-- Rollback: supabase/rollback/20261118000012_unified_billing_down.sql (see docs/migrations-11-12-review.md).
--
-- Effects on existing data: none changed or deleted. The CHECK added to entitlements is NOT VALID, so it is enforced
-- for new and updated rows without rescanning (the table is empty in the target project).

alter table budgetbuddy.payment_events add column event_type text, add column outcome text;

alter table budgetbuddy.entitlements
  add constraint entitlements_paid_needs_period
  check (plan = 'free' or status in ('canceled', 'past_due') or current_period_end is not null) not valid;

create table budgetbuddy.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  provider text not null check (provider in ('razorpay', 'paypal')),
  provider_customer_id text,
  provider_subscription_id text not null,
  plan text not null default 'pro' check (plan in ('pro')),
  interval text not null check (interval in ('month', 'year')),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'pending' check (status in ('pending', 'active', 'past_due', 'canceled', 'expired')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  started_at timestamptz,
  canceled_at timestamptz,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_subscription_id),
  constraint billing_active_needs_period check (status <> 'active' or current_period_end is not null)
);
create index on budgetbuddy.billing_subscriptions (user_id);
-- Protects against repeated checkout creation: one open attempt per person, provider and interval.
create unique index billing_one_pending_checkout on budgetbuddy.billing_subscriptions (user_id, provider, interval) where status = 'pending';

create table budgetbuddy.billing_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  subscription_id uuid references budgetbuddy.billing_subscriptions (id) on delete set null,
  provider text not null check (provider in ('razorpay', 'paypal')),
  provider_payment_id text not null,
  provider_order_id text,
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null check (status in ('created', 'authorized', 'captured', 'failed', 'partially_refunded', 'refunded')),
  failure_reason text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_payment_id)
);
create index on budgetbuddy.billing_payments (user_id, created_at desc);
create index on budgetbuddy.billing_payments (subscription_id);

create table budgetbuddy.billing_audit (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  provider text,
  actor text not null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on budgetbuddy.billing_audit (user_id, created_at desc);

alter table budgetbuddy.billing_subscriptions enable row level security;
alter table budgetbuddy.billing_payments enable row level security;
alter table budgetbuddy.billing_audit enable row level security;
create policy billing_subscriptions_own on budgetbuddy.billing_subscriptions for select to authenticated using (user_id = (select auth.uid()) or budgetbuddy.is_platform_admin());
create policy billing_payments_own on budgetbuddy.billing_payments for select to authenticated using (user_id = (select auth.uid()) or budgetbuddy.is_platform_admin());
create policy billing_audit_own on budgetbuddy.billing_audit for select to authenticated using (user_id = (select auth.uid()) or budgetbuddy.is_platform_admin());
revoke all on budgetbuddy.billing_subscriptions, budgetbuddy.billing_payments, budgetbuddy.billing_audit from anon, authenticated;
grant select on budgetbuddy.billing_subscriptions, budgetbuddy.billing_payments, budgetbuddy.billing_audit to authenticated;
grant all on budgetbuddy.billing_subscriptions, budgetbuddy.billing_payments, budgetbuddy.billing_audit, budgetbuddy.payment_events, budgetbuddy.entitlements to service_role;
grant usage, select on sequence budgetbuddy.billing_audit_id_seq to service_role;

-- ───────────── the access rules, in one place ─────────────
-- Recomputes the entitlement row for one subscription from the stored state (never from an event payload), so it is
-- idempotent and can be re-run at any time. Returns 'granted', 'revoked' or 'skipped'.
create function budgetbuddy.billing_project_entitlement(p_sub uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  s budgetbuddy.billing_subscriptions;
  ent budgetbuddy.entitlements;
  latest text;
  st text;
  en timestamptz;
begin
  select * into s from budgetbuddy.billing_subscriptions where id = p_sub;
  if not found or s.user_id is null then return 'skipped'; end if;
  if s.status = 'pending' then return 'skipped'; end if; -- rule 1

  select p.status into latest from budgetbuddy.billing_payments p
   where p.subscription_id = s.id and p.status in ('captured', 'partially_refunded', 'refunded')
   order by coalesce(p.paid_at, p.created_at) desc, p.created_at desc limit 1;

  en := s.current_period_end;
  if latest = 'refunded' or s.status = 'expired' then
    st := 'canceled';                                   -- rules 5 and 6
    en := case when en is null then null else least(en, now()) end;
  elsif s.status = 'active' then
    if en is null then return 'skipped'; end if;       -- rule 2
    st := case when en > now() then 'active' else 'past_due' end; -- rule 3
  else
    st := s.status;                                     -- past_due, or canceled kept to its stored end (rule 4)
  end if;

  select * into ent from budgetbuddy.entitlements where user_id = s.user_id;
  -- Do not let an unrelated, older subscription overwrite another one that is still paid up.
  if found and ent.provider_ref is distinct from s.provider_subscription_id and ent.status = 'active' and ent.current_period_end > now() then
    return 'skipped';
  end if;

  insert into budgetbuddy.entitlements (user_id, plan, status, provider, provider_ref, current_period_end, updated_at)
    values (s.user_id, 'pro', st, s.provider, s.provider_subscription_id, en, now())
  on conflict (user_id) do update set plan = 'pro', status = excluded.status, provider = excluded.provider,
    provider_ref = excluded.provider_ref, current_period_end = excluded.current_period_end, updated_at = now();
  return case when st = 'active' then 'granted' else 'revoked' end;
end $$;
revoke all on function budgetbuddy.billing_project_entitlement(uuid) from public, anon, authenticated;
grant execute on function budgetbuddy.billing_project_entitlement(uuid) to service_role;

-- What a database-side consumer may use to ask "is this person on Pro right now?". Same rules as the app's
-- resolveEntitlement(): a paid period must be current; past_due gets seven days; anything else is free.
create function budgetbuddy.billing_current_plan() returns text
language sql stable security definer set search_path = '' as $$
  select case when e.plan = 'pro' and e.current_period_end is not null and (
      (e.status in ('active', 'trialing', 'canceled') and e.current_period_end > now())
      or (e.status = 'past_due' and e.current_period_end + interval '7 days' > now())
    ) then 'pro' else 'free' end
  from (select 1) one left join budgetbuddy.entitlements e on e.user_id = (select auth.uid())
$$;
revoke all on function budgetbuddy.billing_current_plan() from public, anon;
grant execute on function budgetbuddy.billing_current_plan() to authenticated;

-- Moves subscriptions whose paid period has run out to their final state and re-projects the entitlement. Meant to be
-- run daily (see /api/cron/billing); safe to run any number of times.
create function budgetbuddy.billing_sweep_expired() returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0;
begin
  for r in
    select id, status from budgetbuddy.billing_subscriptions
     where current_period_end is not null and (
       (status = 'active' and current_period_end <= now())
       or (status = 'past_due' and current_period_end + interval '7 days' < now())
       or (status = 'canceled' and current_period_end < now()))
  loop
    update budgetbuddy.billing_subscriptions
       set status = case when r.status = 'active' then 'past_due' else 'expired' end, updated_at = now()
     where id = r.id;
    perform budgetbuddy.billing_project_entitlement(r.id);
    insert into budgetbuddy.billing_audit (provider, actor, action, detail)
      values (null, 'sweep', case when r.status = 'active' then 'renewal_overdue' else 'expired' end, jsonb_build_object('subscription', r.id));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function budgetbuddy.billing_sweep_expired() from public, anon, authenticated;
grant execute on function budgetbuddy.billing_sweep_expired() to service_role;

-- ───────────── applying one verified provider event ─────────────
-- p_payment may be one payment object or an array of them. Returns 'duplicate', 'unmatched', 'stale' (older than the
-- subscription state already held) or 'applied'.
create function budgetbuddy.billing_apply_event(
  p_provider text,
  p_event_id text,
  p_event_type text,
  p_event_at timestamptz,
  p_user uuid,
  p_subscription jsonb,
  p_payment jsonb
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := p_user;
  pays jsonb := case jsonb_typeof(p_payment) when 'array' then p_payment when 'object' then jsonb_build_array(p_payment) else '[]'::jsonb end;
  sub_pid text := coalesce(p_subscription ->> 'provider_subscription_id', pays -> 0 ->> 'provider_subscription_id');
  sub budgetbuddy.billing_subscriptions;
  sub_id uuid;
  pay jsonb;
  old_status text;
  new_rank int;
  old_rank int;
  newly_refunded boolean := false;
  n int;
  result text := 'applied';
  projected text;
begin
  if p_provider not in ('razorpay', 'paypal') then raise exception 'Unknown provider' using errcode = '22023'; end if;

  insert into budgetbuddy.payment_events (provider, event_id, event_type) values (p_provider, p_event_id, p_event_type)
    on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return 'duplicate'; end if;

  if sub_pid is not null then
    select * into sub from budgetbuddy.billing_subscriptions where provider = p_provider and provider_subscription_id = sub_pid;
    sub_id := sub.id;
    uid := coalesce(sub.user_id, uid); -- the owner on record wins over any note carried in the payload
  end if;

  -- Refunds and bare payment events name only the payment: find the person through the payment already recorded.
  if uid is null and sub_id is null and jsonb_array_length(pays) > 0 then
    select user_id, subscription_id into uid, sub_id from budgetbuddy.billing_payments
     where provider = p_provider and provider_payment_id = pays -> 0 ->> 'provider_payment_id';
    if sub_id is not null then select * into sub from budgetbuddy.billing_subscriptions where id = sub_id; end if;
  end if;

  if uid is null or (sub_pid is not null and sub_id is null) then
    -- Only subscriptions this app created at checkout are honoured. A signed event for anything else (another
    -- product on the same provider account, a forged user note) is recorded for audit and never applied.
    update budgetbuddy.payment_events set outcome = 'unmatched' where provider = p_provider and event_id = p_event_id;
    insert into budgetbuddy.billing_audit (provider, actor, action, detail)
      values (p_provider, 'webhook', 'event_unmatched', jsonb_build_object('event_id', p_event_id, 'type', p_event_type));
    return 'unmatched';
  end if;

  -- Subscription state, guarded by the provider's event time so an older event cannot overwrite a newer one.
  if p_subscription is not null and sub_id is not null then
    update budgetbuddy.billing_subscriptions s set
      provider_customer_id = coalesce(p_subscription ->> 'provider_customer_id', s.provider_customer_id),
      status = case
        when coalesce(p_subscription ->> 'status', s.status) = 'pending' and s.status <> 'pending' then s.status            -- rule 7
        when coalesce(p_subscription ->> 'status', s.status) = 'active'
             and coalesce((p_subscription ->> 'current_period_end')::timestamptz, s.current_period_end) is null then s.status -- rule 2
        else coalesce(p_subscription ->> 'status', s.status) end,
      current_period_start = coalesce((p_subscription ->> 'current_period_start')::timestamptz, s.current_period_start),
      current_period_end = coalesce((p_subscription ->> 'current_period_end')::timestamptz, s.current_period_end),
      cancel_at_period_end = case when p_subscription ? 'cancel_at_period_end' then (p_subscription ->> 'cancel_at_period_end')::boolean else s.cancel_at_period_end end,
      started_at = coalesce(s.started_at, (p_subscription ->> 'started_at')::timestamptz),
      canceled_at = coalesce((p_subscription ->> 'canceled_at')::timestamptz, s.canceled_at),
      last_event_at = p_event_at,
      updated_at = now()
    where s.id = sub_id and (s.last_event_at is null or s.last_event_at <= p_event_at);
    if not found then result := 'stale'; end if;
  end if;

  -- Payment ledger. A payment only moves forward: created < authorized/failed < captured < partially_refunded < refunded.
  for pay in select * from jsonb_array_elements(pays) loop
    new_rank := case pay ->> 'status' when 'created' then 0 when 'authorized' then 1 when 'failed' then 1 when 'captured' then 2 when 'partially_refunded' then 3 when 'refunded' then 4 else 0 end;
    select status into old_status from budgetbuddy.billing_payments where provider = p_provider and provider_payment_id = pay ->> 'provider_payment_id';
    old_rank := case old_status when 'created' then 0 when 'authorized' then 1 when 'failed' then 1 when 'captured' then 2 when 'partially_refunded' then 3 when 'refunded' then 4 else -1 end;
    if old_status is null then
      insert into budgetbuddy.billing_payments (user_id, subscription_id, provider, provider_payment_id, provider_order_id, amount_minor, currency, status, failure_reason, paid_at)
      values (uid, sub_id, p_provider, pay ->> 'provider_payment_id', pay ->> 'provider_order_id',
        coalesce((pay ->> 'amount_minor')::bigint, sub.amount_minor, 0), coalesce(pay ->> 'currency', sub.currency, 'INR'), pay ->> 'status',
        left(pay ->> 'failure_reason', 200), (pay ->> 'paid_at')::timestamptz);
      newly_refunded := newly_refunded or (pay ->> 'status') = 'refunded';
    elsif new_rank >= old_rank then
      update budgetbuddy.billing_payments set
        status = pay ->> 'status',
        subscription_id = coalesce(subscription_id, sub_id),
        provider_order_id = coalesce(provider_order_id, pay ->> 'provider_order_id'),
        failure_reason = coalesce(left(pay ->> 'failure_reason', 200), failure_reason),
        paid_at = coalesce((pay ->> 'paid_at')::timestamptz, paid_at),
        updated_at = now()
      where provider = p_provider and provider_payment_id = pay ->> 'provider_payment_id';
      newly_refunded := newly_refunded or ((pay ->> 'status') = 'refunded' and old_status <> 'refunded');
    end if;
  end loop;

  -- Re-derive the entitlement from stored state (never from the payload). Idempotent, and self-correcting.
  if sub_id is not null then
    projected := budgetbuddy.billing_project_entitlement(sub_id);
  end if;

  update budgetbuddy.payment_events set outcome = result where provider = p_provider and event_id = p_event_id;
  insert into budgetbuddy.billing_audit (user_id, provider, actor, action, detail)
    values (uid, p_provider, 'webhook', p_event_type, jsonb_build_object('event_id', p_event_id, 'outcome', result, 'entitlement', projected,
      'subscription', sub_pid, 'payments', jsonb_array_length(pays), 'status', p_subscription ->> 'status'));
  if newly_refunded then
    insert into budgetbuddy.billing_audit (user_id, provider, actor, action, detail)
      values (uid, p_provider, 'webhook', 'payment_refunded', jsonb_build_object('event_id', p_event_id, 'entitlement', projected));
  end if;
  return result;
end $$;
revoke all on function budgetbuddy.billing_apply_event(text, text, text, timestamptz, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function budgetbuddy.billing_apply_event(text, text, text, timestamptz, uuid, jsonb, jsonb) to service_role;
