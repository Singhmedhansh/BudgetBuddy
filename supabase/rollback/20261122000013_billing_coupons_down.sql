-- Rolls back migration 13. Destroys coupon definitions and their redemption history: export them first.
drop function if exists budgetbuddy.billing_redeem_for_subscription(text, text);
alter table budgetbuddy.billing_subscriptions drop column if exists coupon_id, drop column if exists plan_ref, drop column if exists trial_days;
drop table if exists budgetbuddy.billing_coupon_redemptions;
drop table if exists budgetbuddy.billing_coupons;
