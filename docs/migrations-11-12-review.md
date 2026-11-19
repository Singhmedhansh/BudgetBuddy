# Migrations 11 and 12: review, risks, rollback

Files: `supabase/migrations/20261118000011_ai_monitoring_and_platform_admin.sql`,
`supabase/migrations/20261118000012_unified_billing.sql`. **Neither has been applied to any database.** Every check below
was run against the real migration files executed in-process (PGlite) after migrations 1 to 10, plus read-only
inspection of the shared project. Nothing was written to the shared database.

## State of the shared project (read-only inspection, 19 Nov 2026)

- Project `glgpgmptugomfxoteyys` (ap-south-1) also hosts HireCheck (`public` schema, migrations `hirecheck_initial_schema`,
  `listings_cache`). BudgetBuddy/FinTrack migrations 1 to 10 are recorded as applied (under different version numbers from
  the file names, applied through the dashboard/MCP). Migrations 11 and 12 are not.
- `budgetbuddy.ai_usage`, `budgetbuddy.entitlements`, `budgetbuddy.payment_events`: **0 rows each**, so nothing existing is at
  risk from the column additions or the new CHECK.
- No object named `platform_admins`, `billing_*`, `is_platform_admin`, `ai_usage_summary` or `billing_apply_event` exists anywhere.
  The only function replaced is `budgetbuddy.ai_settle` (7 arguments to 11 arguments with defaults).

## Does it touch shared objects?

| Object | Effect |
| --- | --- |
| `public.*` (HireCheck) | None. Every new object is in `budgetbuddy`. A test asserts this. |
| `auth.users` | Foreign keys only. **`ON DELETE SET NULL`, never CASCADE** on the billing tables: removing a sign-in identity, including from another product that shares this auth project, cannot erase billing records. (`entitlements` and `ai_usage` already cascade from migration 9, unchanged; they are derived or per-person operational data.) |
| `budgetbuddy.entitlements` | One `CHECK ... NOT VALID` added: an active or trialing row must have a paid-through date. Not rescanned; table is empty. |
| `budgetbuddy.payment_events` | Two nullable columns added. |
| `budgetbuddy.ai_usage` | Four columns with defaults added (no table rewrite on Postgres 17), one index. Existing app code that calls the old `ai_settle` keeps working. |

## The access rules, and the test that proves each

All in `src/db/billing-rules.test.ts` and `src/db/billing.test.ts` (41 database tests), enforced in SQL by
`billing_project_entitlement`, so they hold whichever provider, route, cron job or manual repair writes the data.

| Requirement | Rule and evidence |
| --- | --- |
| Activation always needs a valid, non-expired period | An `active` subscription needs a paid-through date (table CHECK; an event without one is refused and the subscription stays pending). `active` with a date already past is projected as `past_due`, never `active`. `entitlements` itself refuses `active`/`trialing` without a date. |
| Pending or incomplete payments cannot grant Pro | `pending` never projects. Tested with a future date plus a captured payment, a payment alone, and authorised/failed payments. A late `pending` event cannot pull a started subscription back to pending. |
| Cancellation preserves access to the real period end | `canceled` keeps the stored end (an event without a date does not change it); access is to that date, not "now" and not beyond. A cancellation before any payment grants nothing. |
| Expired subscriptions cannot stay entitled | `expired` caps the period end at now. The daily sweep (`billing_sweep_expired`) moves overdue subscriptions on and is idempotent. |
| Refund and failed-renewal states | See below. |
| RLS prevents cross-user access | People read only their own subscriptions, payments, audit rows and entitlement; cannot write; cannot call the functions. Tested with two people, including `update`/`delete` attempts. |
| Admin access restricted | Only rows in `platform_admins`, which people cannot read or write and which starts empty, can read all billing rows or call `ai_usage_summary`. Admins read; they cannot write. |

### Refund and failed-renewal policy (**owner decision, please confirm**)

- A **full refund of the most recent paid payment ends access immediately**; a partial refund does not; a later paid renewal
  supersedes the refund and restores access. This is a policy I chose as the conservative reading of "refund": if you would
  rather keep access to the end of the period after a refund, change rule 6 in `billing_project_entitlement`.
- A **failed renewal** is a `failed` ledger row (Razorpay: id `renewal_failed:<subscription>:<paid_count>`, so provider retries
  of one renewal are one row; PayPal: a `DECLINED` transaction) and the subscription becomes `past_due`. The app grants a seven-day
  grace period from the paid-through date, then Free. A later successful charge restores `active`; the failure stays on record.

### Ledger: idempotency and ordering

Event ids are stored once (duplicate = no-op, tested). A failure rolls the event id back with everything else so the provider's
retry is processed (tested). An older event never overwrites newer subscription state, but its payments are still recorded. A
payment only moves forward (created, authorised/failed, captured, partly refunded, refunded): a late `captured` cannot undo a
refund, a late `failed` cannot undo `captured` (tested). PayPal's ledger is the provider's own transaction list (real ids, so
`PAYMENT.SALE.REFUNDED` matches the original sale); the daily cron re-reads every live subscription from both providers, so a
refund that arrived before its payment was recorded is repaired within a day.

## Risks that remain

1. **Retention is undecided.** Billing rows survive "delete my data" and identity deletion by design. Confirm the period with the
   privacy policy before launch.
2. **`entitlements` still cascades on identity deletion** (migration 9). The billing tables keep the record; the plan row goes.
3. **Index build.** `ai_usage (created_at)` is created without `CONCURRENTLY` (not possible inside a migration transaction). The table
   is empty, so this is instant now; do not reuse the pattern on a large table.
4. **Unverified against real providers.** The PayPal transaction `id` is assumed to equal the sale id named by sale and refund
   webhooks, and Razorpay's `payment.*` entity may not carry a subscription id. Both are handled safely (unmatched events are
   stored and repaired by the daily reconcile) but only a sandbox run can confirm the fast path.
5. **Several subscriptions per person.** Checkout refuses a second while one is live, and a different subscription cannot overwrite
   an entitlement that is still paid up. A person with two live subscriptions from before this change would need manual attention.
6. **Cron.** `/api/cron/billing` needs `CRON_SECRET` (16+ characters) and a Vercel plan that allows daily crons. Without it the
   sweep does not run: access still ends correctly (the app and `billing_current_plan()` evaluate dates at read time), but
   statuses stay stale and missed webhooks are not repaired.
7. **Default privileges.** The migrations revoke execute from `public`/`anon` and grant explicitly; a database with unusual
   default privileges on the `budgetbuddy` schema should be checked with `get_advisors` after applying.

## How to apply (when approved)

1. Take a backup (Supabase dashboard, or a branch) of the shared project.
2. Apply 11, then 12, in that order. Both are plain forward migrations in one transaction each.
3. Run `get_advisors` (security and performance) and read the output.
4. Insert yourself into `platform_admins` by hand if you want `/app/admin/ai`.
5. Do **not** set `LIVE_PAYMENTS_ALLOWED` or add live keys.

## Rollback and recovery

Scripts live in `supabase/rollback/` (outside `migrations/`, so nothing runs them automatically). Roll back **12 first, then 11**.

- `20261118000012_unified_billing_down.sql`: drops the three billing tables and four functions, the CHECK on `entitlements`, and
  the two `payment_events` columns. **Destroys the payment ledger and audit trail: export them first.** Entitlement rows already
  written stay (they are the plan people currently have); delete or edit them by hand if the rollback must remove paid access.
- `20261118000011_ai_monitoring_and_platform_admin_down.sql`: drops the admin functions and `platform_admins` (re-insert admins
  after re-applying), restores the original 7-argument `ai_settle`, drops the four `ai_usage` columns.
- **Recovery:** the forward migrations run again on a rolled-back database. `src/db/rollback.test.ts` proves the whole loop:
  apply, roll back 12 then 11, check the old `ai_settle` works and the objects are gone, re-apply both, and confirm billing works.
- Application compatibility: the code tolerates the tables being absent (billing and admin pages render empty states; the
  assistant's usage recording is best-effort), so deploying the code before the migrations, or rolling the migrations back
  under a running deployment, does not break signed-in pages. Checkout and webhooks need migration 12 and answer with an error
  until it is applied.
