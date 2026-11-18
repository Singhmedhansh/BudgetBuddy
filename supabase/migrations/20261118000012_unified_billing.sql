-- Migration 12: one provider-independent billing system for Razorpay and PayPal.
--
-- Existing from migration 9 and kept as it is: `entitlements` (the one row the rest of the app reads to decide the
-- plan) and `payment_events` (webhook idempotency). They are extended, not duplicated.
--
-- New:
--   billing_subscriptions  one row per provider subscription. Created as 'pending' when checkout starts, so the amount,
--                          currency and interval the server expects are on record BEFORE anything is paid, and a
--                          payment can be checked against them. Never against a price sent by the browser.
--   billing_payments       the payment ledger: one row per provider payment, with a rank so a late "failed" event can
--                          never overwrite a "captured" one.
--   billing_audit          append-only history of every billing decision (no secrets, no card data).
--
-- Writes happen only through billing_apply_event(), callable by the service role alone. It records the webhook event
-- id, applies the change and updates the entitlement in ONE transaction: a failure rolls the event id back too, so
-- the provider's retry is processed, and a duplicate delivery is a no-op. Events carry the provider's own timestamp;
-- an older event never overwrites newer subscription state (out-of-order delivery).
--
-- RLS: people read only their own billing rows; platform admins (migration 11) read all. Nobody can write from the
-- app. Billing rows are financial records and are NOT removed by delete_my_data(): retention is an owner decision.
--
-- Effects: new tables and one new function; two columns added to payment_events. No data changed or deleted.

alter table budgetbuddy.payment_events add column event_type text, add column outcome text;

create table budgetbuddy.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
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
  unique (provider, provider_subscription_id)
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

-- Applies one verified provider event. Returns 'duplicate', 'unmatched', 'stale' (older than state already held) or 'applied'.
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
  sub_pid text := coalesce(p_subscription ->> 'provider_subscription_id', p_payment ->> 'provider_subscription_id');
  sub budgetbuddy.billing_subscriptions;
  sub_id uuid;
  sub_applied boolean := false;
  pay_rank_new int;
  pay_rank_old int;
  old_status text;
  n int;
  result text := 'applied';
  ent_status text;
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

  -- Refunds and bare payment events name only the payment: find the person through the payment we already recorded.
  if uid is null and p_payment is not null then
    select user_id, subscription_id into uid, sub_id from budgetbuddy.billing_payments
     where provider = p_provider and provider_payment_id = p_payment ->> 'provider_payment_id';
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
  if p_subscription is not null then
    insert into budgetbuddy.billing_subscriptions as s (
      user_id, provider, provider_customer_id, provider_subscription_id, plan, interval, amount_minor, currency, status,
      current_period_start, current_period_end, cancel_at_period_end, started_at, canceled_at, last_event_at)
    values (
      uid, p_provider, p_subscription ->> 'provider_customer_id', sub_pid, 'pro',
      coalesce(p_subscription ->> 'interval', 'month'), coalesce((p_subscription ->> 'amount_minor')::bigint, 1), coalesce(p_subscription ->> 'currency', 'INR'),
      coalesce(p_subscription ->> 'status', 'pending'),
      (p_subscription ->> 'current_period_start')::timestamptz, (p_subscription ->> 'current_period_end')::timestamptz,
      coalesce((p_subscription ->> 'cancel_at_period_end')::boolean, false),
      (p_subscription ->> 'started_at')::timestamptz, (p_subscription ->> 'canceled_at')::timestamptz, p_event_at)
    on conflict (provider, provider_subscription_id) do update set
      provider_customer_id = coalesce(excluded.provider_customer_id, s.provider_customer_id),
      status = coalesce(p_subscription ->> 'status', s.status),
      current_period_start = coalesce(excluded.current_period_start, s.current_period_start),
      current_period_end = coalesce(excluded.current_period_end, s.current_period_end),
      cancel_at_period_end = case when p_subscription ? 'cancel_at_period_end' then excluded.cancel_at_period_end else s.cancel_at_period_end end,
      started_at = coalesce(s.started_at, excluded.started_at),
      canceled_at = coalesce(excluded.canceled_at, s.canceled_at),
      last_event_at = p_event_at,
      updated_at = now()
    where s.last_event_at is null or s.last_event_at <= p_event_at
    returning s.id into sub_id;
    sub_applied := found;
    if not sub_applied then
      result := 'stale';
      select id into sub_id from budgetbuddy.billing_subscriptions where provider = p_provider and provider_subscription_id = sub_pid;
    end if;
  end if;

  -- Payment ledger. A payment only moves forward: created < authorized/failed < captured < partially_refunded < refunded.
  if p_payment is not null then
    pay_rank_new := case p_payment ->> 'status' when 'created' then 0 when 'authorized' then 1 when 'failed' then 1 when 'captured' then 2 when 'partially_refunded' then 3 when 'refunded' then 4 else 0 end;
    select status into old_status from budgetbuddy.billing_payments where provider = p_provider and provider_payment_id = p_payment ->> 'provider_payment_id';
    pay_rank_old := case old_status when 'created' then 0 when 'authorized' then 1 when 'failed' then 1 when 'captured' then 2 when 'partially_refunded' then 3 when 'refunded' then 4 else -1 end;
    if old_status is null then
      insert into budgetbuddy.billing_payments (user_id, subscription_id, provider, provider_payment_id, provider_order_id, amount_minor, currency, status, failure_reason, paid_at)
      values (uid, sub_id, p_provider, p_payment ->> 'provider_payment_id', p_payment ->> 'provider_order_id',
        coalesce((p_payment ->> 'amount_minor')::bigint, 0), coalesce(p_payment ->> 'currency', 'INR'), p_payment ->> 'status',
        left(p_payment ->> 'failure_reason', 200), (p_payment ->> 'paid_at')::timestamptz);
    elsif pay_rank_new >= pay_rank_old then
      update budgetbuddy.billing_payments set
        status = p_payment ->> 'status',
        subscription_id = coalesce(subscription_id, sub_id),
        provider_order_id = coalesce(provider_order_id, p_payment ->> 'provider_order_id'),
        failure_reason = coalesce(left(p_payment ->> 'failure_reason', 200), failure_reason),
        paid_at = coalesce((p_payment ->> 'paid_at')::timestamptz, paid_at),
        updated_at = now()
      where provider = p_provider and provider_payment_id = p_payment ->> 'provider_payment_id';
    end if;
  end if;

  -- The one row the rest of the app reads. A pending checkout never grants anything; an active plan needs a period end.
  if sub_applied then
    select * into sub from budgetbuddy.billing_subscriptions where id = sub_id;
    if sub.status in ('active', 'past_due', 'canceled', 'expired') then
      ent_status := case sub.status when 'expired' then 'canceled' else sub.status end;
      insert into budgetbuddy.entitlements (user_id, plan, status, provider, provider_ref, current_period_end, updated_at)
        values (sub.user_id, 'pro', ent_status, sub.provider, sub.provider_subscription_id, sub.current_period_end, now())
      on conflict (user_id) do update set plan = 'pro', status = excluded.status, provider = excluded.provider,
        provider_ref = excluded.provider_ref, current_period_end = excluded.current_period_end, updated_at = now();
    end if;
  end if;

  update budgetbuddy.payment_events set outcome = result where provider = p_provider and event_id = p_event_id;
  insert into budgetbuddy.billing_audit (user_id, provider, actor, action, detail)
    values (uid, p_provider, 'webhook', p_event_type, jsonb_build_object('event_id', p_event_id, 'outcome', result,
      'subscription', sub_pid, 'payment', p_payment ->> 'provider_payment_id', 'status', coalesce(p_subscription ->> 'status', p_payment ->> 'status')));
  return result;
end $$;
revoke all on function budgetbuddy.billing_apply_event(text, text, text, timestamptz, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function budgetbuddy.billing_apply_event(text, text, text, timestamptz, uuid, jsonb, jsonb) to service_role;
