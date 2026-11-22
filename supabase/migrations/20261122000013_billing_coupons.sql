-- Migration 13: promotion codes (coupons) and the bookkeeping a free trial needs.
--
--   billing_coupons               one row per code. Today the only kind is `trial_days`: a longer free trial (for example the
--                                 code printed on an Instagram ad gives 30 days instead of the standard 5). `kind` is a column
--                                 so other kinds (a percentage off) can be added without reshaping the table.
--   billing_coupon_redemptions    one row per person per code, written when the subscription that used the code actually
--                                 STARTS (not when the code is typed), so an abandoned checkout never uses a code up.
--   billing_subscriptions         gains trial_days (the trial this checkout promised), plan_ref (the provider plan it was
--                                 created on, needed when a coupon chose it) and coupon_id.
--
-- Only the server (service role) reads or writes coupons. People cannot list them or guess them through the API; platform
-- admins (migration 11) can read both tables. Nothing is changed or deleted in existing data.
--
-- Rollback: supabase/rollback/20261122000013_billing_coupons_down.sql

create table budgetbuddy.billing_coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9_-]{3,32}$'),
  campaign text check (campaign is null or char_length(campaign) <= 60),
  kind text not null default 'trial_days' check (kind in ('trial_days')),
  trial_days integer check (trial_days between 1 and 365),
  intervals text[] not null default array['month', 'year'] check (intervals <@ array['month', 'year']),
  -- PayPal fixes the trial length inside the plan, so a code with a custom trial names the PayPal plans made for it:
  -- {"month": "P-...", "year": "P-..."}. Razorpay needs nothing here (the first charge date is set per subscription).
  paypal_plan_ids jsonb not null default '{}'::jsonb,
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  redeemed_count integer not null default 0 check (redeemed_count >= 0),
  valid_from timestamptz,
  valid_until timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint billing_coupon_trial_days_set check (kind <> 'trial_days' or trial_days is not null)
);

alter table budgetbuddy.billing_subscriptions
  add column trial_days integer check (trial_days is null or trial_days > 0),
  add column plan_ref text,
  add column coupon_id uuid references budgetbuddy.billing_coupons (id) on delete set null;

create table budgetbuddy.billing_coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references budgetbuddy.billing_coupons (id) on delete restrict,
  user_id uuid references auth.users (id) on delete set null,
  subscription_id uuid references budgetbuddy.billing_subscriptions (id) on delete set null,
  created_at timestamptz not null default now()
);
-- One use of a code per person, enforced by the database.
create unique index billing_coupon_one_per_person on budgetbuddy.billing_coupon_redemptions (coupon_id, user_id) where user_id is not null;
create index on budgetbuddy.billing_coupon_redemptions (coupon_id);

alter table budgetbuddy.billing_coupons enable row level security;
alter table budgetbuddy.billing_coupon_redemptions enable row level security;
create policy billing_coupons_admin on budgetbuddy.billing_coupons for select to authenticated using (budgetbuddy.is_platform_admin());
create policy billing_coupon_redemptions_admin on budgetbuddy.billing_coupon_redemptions for select to authenticated using (budgetbuddy.is_platform_admin());
revoke all on budgetbuddy.billing_coupons, budgetbuddy.billing_coupon_redemptions from anon, authenticated;
grant select on budgetbuddy.billing_coupons, budgetbuddy.billing_coupon_redemptions to authenticated; -- rows still limited to admins by the policies above
grant all on budgetbuddy.billing_coupons, budgetbuddy.billing_coupon_redemptions to service_role;

-- Records that the subscription which used a code has started. Idempotent: calling it again changes nothing, so every path
-- that can start a subscription (the checkout step, the return page, a webhook, the daily reconcile) may call it.
create function budgetbuddy.billing_redeem_for_subscription(p_provider text, p_sub text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare s budgetbuddy.billing_subscriptions; n integer;
begin
  select * into s from budgetbuddy.billing_subscriptions where provider = p_provider and provider_subscription_id = p_sub;
  if not found or s.coupon_id is null or s.user_id is null or s.status in ('pending', 'expired') then return false; end if;
  insert into budgetbuddy.billing_coupon_redemptions (coupon_id, user_id, subscription_id) values (s.coupon_id, s.user_id, s.id) on conflict do nothing;
  get diagnostics n = row_count;
  if n = 1 then
    update budgetbuddy.billing_coupons set redeemed_count = redeemed_count + 1 where id = s.coupon_id;
  end if;
  return n = 1;
end $$;
revoke all on function budgetbuddy.billing_redeem_for_subscription(text, text) from public, anon, authenticated;
grant execute on function budgetbuddy.billing_redeem_for_subscription(text, text) to service_role;
