-- ROLLBACK for migration 12 (unified billing). NOT run automatically: it lives outside supabase/migrations on purpose.
-- Run only after reading docs/migrations-11-12-review.md. Roll back 12 BEFORE 11 (12's policies use is_platform_admin()).
--
-- DESTROYS: billing_subscriptions, billing_payments, billing_audit. These are financial records. Export them first:
--   \copy budgetbuddy.billing_payments to 'billing_payments.csv' csv header   (and the other two tables)
-- LEAVES: entitlements rows already written by billing (they are the plan people currently have; remove or edit them
-- by hand if the rollback is meant to take paid access away), and the event ids in payment_events.
-- Recovery: re-apply the migration file; it is a plain forward migration and runs on a database without these objects.

drop function if exists budgetbuddy.billing_apply_event(text, text, text, timestamptz, uuid, jsonb, jsonb);
drop function if exists budgetbuddy.billing_sweep_expired();
drop function if exists budgetbuddy.billing_current_plan();
drop function if exists budgetbuddy.billing_project_entitlement(uuid);
drop table if exists budgetbuddy.billing_audit;
drop table if exists budgetbuddy.billing_payments;
drop table if exists budgetbuddy.billing_subscriptions;
alter table budgetbuddy.entitlements drop constraint if exists entitlements_paid_needs_period;
alter table budgetbuddy.payment_events drop column if exists event_type, drop column if exists outcome;
