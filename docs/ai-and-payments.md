# AI assistant and payments: how to switch them on

Both are built and tested but **off**. Nothing calls an AI provider or takes a payment until you add credentials.
No credential is stored in the repository; `.env.example` lists every variable with an empty value.

## Verification status (read this first)

Six levels, from weakest to strongest. A feature is only as verified as the **highest level with a tick**; nothing below is
claimed beyond it.

- **Locally tested**: the real code and the real migration files, run on a developer machine (unit tests, in-process Postgres
  for the migrations, a production build driven by headless Chrome against the shared Supabase project with a disposable user).
- **Mock-tested**: provider HTTP calls (Razorpay, PayPal, Gemini, Groq) are replaced by scripted responses. Proves our logic,
  not that the provider behaves as we assume.
- **Sandbox-tested**: exercised against a provider's sandbox/test mode with test credentials.
- **Live-provider-tested**: a real call to a real provider account (for AI there is no sandbox, so this is the only
  provider-level level).
- **Preview-deployed**: running on a Vercel preview deployment and smoke-tested there.
- **Production-deployed**: running on getfintrack.online.

| Capability | Locally | Mock | Sandbox | Live provider | Preview | Production |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| Faster navigation (parallel context, request memo, loading states) | yes | n/a | n/a | n/a | no | no |
| AI gateway routing, fallback, retry, cooldowns, dedup | yes | yes | n/a | **yes** (2 live tests: real answer, forced failover Gemini to Groq) | no | no |
| AI model names | n/a | n/a | n/a | **yes** (live catalogue lists them; a real call to each provider answered) | no | no |
| Statement import: PDF reading, AI categories (CSV categories from history already existed) | yes | yes (11 + 3 tests) | n/a | **yes** (real Gemini/Groq read a sample statement: 3 of 3 rows, amounts exact, 0 dropped, categories correct) | no | no |
| Razorpay checkout, signature and amount verification, webhooks | yes | yes | **no** | no | no | no |
| PayPal checkout, verification, webhooks, refunds and renewals via transactions | yes | yes | **no** | no | no | no |
| Billing rules, ledger, RLS, rollback (migrations 11 and 12) | yes (in-process Postgres) | n/a | n/a | n/a | **not applied anywhere** | no |
| Billing and admin pages | rendered with the tables absent only | n/a | n/a | n/a | no | no |
| Daily billing cron | yes | yes | no | no | no | no |
| End-to-end suite (324 tests) | yes (production build, real Supabase, disposable user) | n/a | n/a | n/a | no | no |
| GitHub Actions CI (`.github/workflows/ci.yml`) | its commands run locally (lint, types, tests, build with placeholder env) | n/a | n/a | n/a | not yet run on GitHub; the e2e job runs only where the `E2E_*` secrets exist | n/a |

Live payments are not tested and are disabled in code. AI is verified but switched off (`AI_ENABLED` unset). Migrations 11 and 12 are not applied to any database.

## AI gateway

All AI calls go through one server-side gateway (`src/server/ai`). Components never call a provider. Keys are read from
server-only environment variables (no `NEXT_PUBLIC_` prefix), are never sent to the browser, and are never written to
logs, errors or the usage dashboard. A test scans the production browser bundle for the variable names.

| Variable | Purpose | Default |
| --- | --- | --- |
| `AI_ENABLED` | Master switch. Must be exactly `true`. | off |
| `GEMINI_API_KEY_1` … `_3`, `GROQ_API_KEY_1` … `_4` | Provider keys (numbered form) | none |
| `GEMINI_API_KEYS`, `GROQ_API_KEYS` | Comma-separated pools, read as well | none |
| `AI_PROVIDER_ORDER` | Which provider is tried first | `gemini,groq` |
| `GEMINI_MODEL`, `GROQ_MODEL` | Ordered, comma-separated model names | see below |
| `AI_<FEATURE>_<PROVIDER>_MODEL` | Per-feature override, e.g. `AI_ASSISTANT_GEMINI_MODEL` | none |
| `AI_KEYS_INDEPENDENT_QUOTA` | `true` only if every key is a separate project or organisation | `false` |
| `AI_REQUESTS_PER_HOUR`, `AI_TOKENS_PER_DAY`, `AI_MAX_OUTPUT_TOKENS`, `AI_MAX_QUESTION_CHARS`, `AI_TIMEOUT_MS` | Limits | 20 / 60000 / 700 / 600 / 20000 |

### Models: check before enabling

Model catalogues move, and **documentation pages contradict each other**, so no name here is trusted until a live key says so.

- Both defaults this project originally shipped with are reported **retired** in 2026 (`gemini-2.0-flash`, 1 June;
  `llama-3.3-70b-versatile`, 16 August), though Groq's current model page still lists the latter. That disagreement is the
  reason for the check below.
- Current defaults, ordered (the second is used only when the first is reported gone): Gemini `gemini-3.5-flash-lite`, then
  `gemini-3.6-flash`; Groq `openai/gpt-oss-120b`, then `openai/gpt-oss-20b`.
- **Verified live on 19 Nov 2026** with the three Gemini and four Groq keys (`npm run ai:models -- --smoke` exits 0, and
  `AI_LIVE_TEST=1` runs `src/server/ai/live.test.ts`). The live catalogues list all four names. This corrected two things the
  documentation pages got wrong: an earlier draft's fallbacks `gemini-3.5-flash` and `qwen/qwen3.6-27b` do not exist.
  Observed behaviour worth knowing:
  - `gemini-3.6-flash` returned **HTTP 503** on every attempt during testing and `gemini-3.8-flash` timed out, so
    `gemini-3.5-flash-lite` is the primary because it answered on all three keys. Gemini answers took 5 to 10 s; Groq under 1 s.
    Preferred-provider order is Gemini first as requested; set `AI_PROVIDER_ORDER=groq,gemini` if latency matters more.
  - `openai/gpt-oss-120b` is a reasoning model: with a very small `max_tokens` its hidden reasoning consumes the whole budget and it
    returns an **empty answer** (`finish_reason: length`). The gateway uses 700 tokens and sends `reasoning_effort: low` for this family.
  - This verifies names, keys and the gateway code paths; it is **not** a load or quota test.
- The keys are stored in Vercel (Preview and Production, type Sensitive) as `GEMINI_API_KEYS` and `GROQ_API_KEYS`. **`AI_ENABLED`
  is not set anywhere**, so the assistant is off until you set it.

```
npm run ai:models              # lists which configured names each provider offers today (exit 0 = all found, 1 = failed, 2 = no keys)
npm run ai:models -- --smoke   # plus one tiny prompt per provider (about 20 output tokens); exit 1 = a model is missing or failed
```

Then set `GEMINI_MODEL` / `GROQ_MODEL` to whatever it reports, and only then set `AI_ENABLED=true`. A model the provider says is gone is rested for 30 minutes
and the next name in the list is used automatically.

### How requests are routed

1. The question is validated and the person's limits are **reserved in the database before any call** (per-person lock,
   so parallel requests cannot slip past them and extra keys cannot be used to exceed them).
2. Providers are tried in order (Gemini, then Groq). A provider whose keys are all resting is skipped without a call.
3. Failure handling, per upstream call:

| Failure | Behaviour |
| --- | --- |
| Rate limit (429) | The provider rests for the time it asks (cap 5 min, default 60 s) and the request **falls back to the next provider**. Other keys of the same provider are not tried, because keys in one Google project or Groq organisation share a quota (`AI_KEYS_INDEPENDENT_QUOTA=true` changes this). |
| Invalid key (401/403, or Gemini's 400 "API key not valid") | The key rests 15 min; the next key is tried. Never retried. |
| 5xx, timeout, network | One retry on the same key after exponential backoff with full jitter (cap 2 s), then the next key or provider. |
| Retired model (404, `model_not_found`) | The model rests 30 min; the provider's next model is used. |
| Empty or malformed response | Treated as a failure of that call; falls back. |
| Bad request (400) | **No fallback** and no retry: it would fail the same way everywhere. |

At most **four upstream calls** are made for one question across all providers, keys and retries. Identical concurrent
submissions from the same person share one reservation and one call. Every outcome is logged as counts and a category
(`ai_usage`: provider, model, status, latency, tokens, error kind, attempts, fallbacks, rate-limited), never text.

### Why it cannot invent figures

The model is given only a JSON summary computed from the ledger (net worth, balances, this month, top categories,
budgets), the same numbers the dashboard shows. It never sees individual transactions. Every amount and percentage in
its answer is checked against that summary; if any figure is not in it, the answer is discarded and the person gets a
plain summary built from the verified figures. The assistant has no write access: it cannot create or change records.

### Usage dashboard (admins)

`/app/admin/ai` shows requests by provider and model, success, failure, rate-limited and fallback counts, average
latency, tokens, error categories and per-instance provider health. It is visible only to platform admins and appears as
a 404 to everyone else. **Nobody is an admin until you add yourself** (the table starts empty and cannot be written from
the app). In the Supabase SQL editor:

```sql
insert into budgetbuddy.platform_admins (user_id) values ('<your auth.users id>');
```

## Statement import with AI (CSV and PDF)

Upload a CSV or a **text-based** PDF (not a scan, not password protected, up to 30 pages and 4 MB) on Import and export.
Nothing is written to the ledger until the person reviews the rows and confirms, so the flow is "upload, then one click", not silent auto-posting.

- **Reading a PDF** needs AI on. The PDF text is split into chunks (at most 8) and the model lists the transactions. Every row is then
  **verified against the PDF text** (its date, its exact amount and the words of its description must all appear there) and parsed by the same strict
  date and amount parsers as a CSV. A row the model invented or whose figure it changed is dropped and listed. A printed Dr/Cr or minus sign overrides the model's direction.
- **Categories** for merchants not seen before are suggested by AI from the person's own category list, by number, and only of the matching kind
  (expense or income). They are marked "Suggested by AI, please check". Only descriptions are sent, never amounts. Merchants already categorised before keep using history.
- **Privacy:** PDF text goes to an external provider. The form says so and has a checkbox; with it unticked a CSV never leaves our servers. Free-tier provider terms may allow
  provider-side retention or training: review the Gemini and Groq terms for your keys and use paid/no-training settings before enabling this for real users.
- **Limits:** shares the per-person AI allowance (20 calls an hour, 60,000 tokens a day by default); a long PDF uses one call per chunk. Uploads use the server-action
  body limit, raised to 5 MB in `next.config.ts`.
- **Not supported:** scans and photos (no OCR), Excel files, password-protected PDFs.
- **Switched off by default:** with `AI_ENABLED` unset a PDF is refused with a plain message and a CSV works exactly as before.

## Payments

Live payments are disabled **in code** (`LIVE_PAYMENTS_ALLOWED` in `src/server/payments/config.ts` is a constant). With it
false, a Razorpay key beginning `rzp_live_` or `PAYPAL_ENVIRONMENT=live` is refused outright, so a production key
pasted into a preview deployment cannot charge a card. Going live is a deliberate code change after owner approval.
Plan prices come from `src/config/plans.ts` and are untouched.

FinTrack One is billed as a **real recurring subscription** at each provider (Razorpay Subscriptions, PayPal
Subscriptions), not a one-off payment presented as one.

### Setup

1. Apply migrations 11 and 12 (additive; see the header of each file). Do not apply them to a shared database before
   reviewing them.
2. Create the plans once, in each provider's **sandbox**:
   `node scripts/billing/create-plans.mjs razorpay` prints `RAZORPAY_PLAN_ID_ONE_MONTHLY=plan_…` (INR 149 / 1,199 from the
   price list). `node scripts/billing/create-plans.mjs paypal --price <x.xx> --currency USD` prints the PayPal plan id.
   **The international (USD) price is an owner decision and has no default.**
3. Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, the plan ids, `PAYPAL_CLIENT_ID`,
   `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_ENVIRONMENT=sandbox`, and `SUPABASE_SERVICE_ROLE_KEY`.
4. Set `CRON_SECRET` (16+ random characters). `vercel.json` schedules `/api/cron/billing` daily at 03:00 UTC; it sweeps expired
   subscriptions and re-reads every live subscription from both providers to repair any missed webhook.
5. Register webhooks: Razorpay → `https://<host>/api/webhooks/razorpay` (subscription.*, payment.captured/failed,
   refund.*); PayPal → `https://<host>/api/webhooks/paypal` (BILLING.SUBSCRIPTION.*, PAYMENT.SALE.COMPLETED).

### How a payment becomes access

- **Razorpay.** The server creates the subscription (after re-reading the dashboard plan and checking it is ₹149 / INR /
  monthly). The browser receives only the public key id and the subscription id and opens Razorpay Checkout. On return
  it sends three identifiers; the server verifies the HMAC signature (`payment_id|subscription_id`), reads the payment
  and subscription back from Razorpay, requires the subscription to carry this person's id and the configured plan,
  requires amount and currency to equal the price list, and only then records it. A payment that is only authorised, or a
  subscription with no paid-through date, leaves the plan off until the webhook confirms it.
- **PayPal.** The server creates the subscription (reading the plan's real price and currency from PayPal) and returns
  PayPal's approval address. The return page and every webhook then **re-read the subscription from PayPal**; the
  callback or event only says "look again". Access needs: it belongs to this person (`custom_id`), the configured plan,
  a recorded payment equal to the price on record, and a renewal date. Webhook deliveries are verified by PayPal's own
  verify-webhook-signature call, with the certificate address restricted to paypal.com.
- **One ledger.** Both providers write through one database function, `billing_apply_event`, which in a single
  transaction stores the event id, applies the change and updates `entitlements`. A duplicate delivery is a no-op; a
  failure rolls the event id back so the provider's retry is processed; an event older than the stored state never
  overwrites it; a payment never moves backwards (a late "failed" cannot undo "captured"); an event for a subscription
  this app did not create is recorded as unmatched and never applied. The rest of the app reads only `entitlements`
  and does not know which provider was used.
- **Statuses:** pending, active, past due (seven-day grace), cancelled (runs to the end of the paid period), expired.
- **Protection against repeat charges and abuse:** one open checkout per person, provider and period (unique index),
  five checkouts per hour, no second subscription while one is running, same-origin check on every cookie-authenticated
  route, input limited to a validated period name (no price is ever read from the browser).

### Ledger behaviour for refunds and failed renewals

- **PayPal.** Every sync reads the subscription's transaction list from PayPal and writes each transaction under its real id, with
  its state (completed, partly refunded, refunded, declined). `PAYMENT.SALE.REFUNDED`/`REVERSED` name the original sale: the
  webhook finds the subscription through the payment already in the ledger and re-syncs. A refund that arrives before its payment
  is recorded is stored as unmatched and repaired by the next daily reconcile.
- **Razorpay.** `subscription.pending`/`halted` (a renewal that could not be charged) writes a `failed` ledger row
  `renewal_failed:<subscription>:<paid_count>`, so retries of one renewal are one row. `refund.*` and `payment.*` events move an
  existing payment row, found by payment id (or by subscription id when Razorpay supplies it).
- **Effect on access:** see `docs/migrations-11-12-review.md` (a full refund of the latest payment ends access; failed renewal is
  past due with a seven-day grace; cancellation keeps access to the paid period end).
- Duplicate events are no-ops; an older event never overwrites newer state; a payment never moves backwards.

### Known limits

- The PayPal transaction `id` is assumed to equal the sale id in PayPal's sale/refund webhooks, and Razorpay's `payment.*`
  entity may not name a subscription. Both fail safe (stored as unmatched, repaired daily) but only a sandbox run confirms the
  fast path.
- Billing rows are financial records and are **not** removed by "delete my data", nor by deleting the sign-in identity (migration 12
  header). Retention is an owner decision to confirm with the privacy policy.
- The refund-ends-access rule is a chosen policy awaiting owner confirmation.
- No sandbox or live credentials were available, so provider calls are covered by mocked-response tests only. Run the sandbox
  checkout end to end before going live.

## Update 22 Nov 2026: one-time Razorpay, invoices, payment check, live switch

- **Razorpay one-time mode.** With no `RAZORPAY_PLAN_ID_*` set, Razorpay runs as Standard Checkout on the Orders API: ₹149 buys 1 month,
  ₹1,199 buys 1 year, no auto-renew. The order row is stored in `billing_subscriptions` with the `order_…` id as its provider id.
  Signature is `order_id|payment_id`; an authorised-only payment is captured by the server. Set plan ids later to return to recurring.
- **Did the payment happen?** `POST /api/billing/razorpay/status` (the "Already paid? Check my payment" button) and the daily cron
  ask Razorpay about open orders and apply a paid one with the same event id as the checkout step, so it is applied once.
- **Invoices.** `/app/settings/billing/invoices/<payment id>` for any captured or refunded payment (print or save as PDF). Numbers look like
  `FT-202611-1A2B3C4D`. Seller details come from `INVOICE_SELLER_NAME`, `INVOICE_SELLER_ADDRESS` (`|` between lines), `INVOICE_GSTIN`,
  `INVOICE_SUPPORT_EMAIL`. No tax is computed: prices are shown as tax-inclusive. Have an accountant confirm GST treatment and numbering.
- **USD prices** for PayPal: $2.99 monthly, $23.99 yearly (`src/config/plans.ts`).
- **Live switch.** `LIVE_PAYMENTS_ALLOWED` is now `true`. A live key (`rzp_live_…`) or `PAYPAL_ENVIRONMENT=live` is accepted; nothing is live until those
  keys are set. Razorpay live keys need account activation (KYC). PayPal live needs a live REST app and live plans.
- **Still required before real money:** apply migrations 11 and 12 (not applied; payment records cannot be written without them), set
  `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET`, register webhooks, and create PayPal plans in the live environment.

### Go-live status, 22 Nov 2026 (read before switching to live)
- Migrations 11 and 12 are applied (billing tables, RLS and functions verified). No billing rows exist yet.
- **Razorpay live** is not switched on. The only live key on the Razorpay account (`rzp_live_Tf65…`) is shared with ai-compass and Manila; its secret
  cannot be re-read and regenerating it (OTP to the owner's phone) would invalidate theirs. Decision: share that key. Still needed: the live
  secret (owner), `getfintrack.online` registered as a website on that account (Razorpay says extra sites must share the first site's business
  model, otherwise a separate account is required: owner's call), the live webhook and `RAZORPAY_WEBHOOK_SECRET`.
- **PayPal live** has no FinTrack app yet (existing live apps belong to AI Compass). Create a dedicated live REST app, live plans ($2.99 / $23.99)
  and a webhook, then set `PAYPAL_ENVIRONMENT=live`.
- Keep live keys in the Vercel Production environment, not `.env.local`: local runs stay in test mode.
- `SUPABASE_SERVICE_ROLE_KEY` is not yet in any environment.
- One small real payment on each provider (refunded afterwards) is the only proof that live works.

### Provider setup completed, 22 Nov 2026 (no secrets here)
- **Razorpay:** dedicated FinTrack account (separate from Manila and ai-compass), `getfintrack.online` approved, live key `rzp_live_U3HU8Ye6B7P2IG` generated, live webhook
  `https://getfintrack.online/api/webhooks/razorpay` enabled (payment.captured, payment.failed, refund.created, refund.processed). The Subscriptions API responds on this account.
- **PayPal:** dedicated live REST app "FinTrack", live plans $2.99 monthly / $23.99 yearly, live webhook `https://getfintrack.online/api/webhooks/paypal`.
- Secrets live only in the Vercel Production environment (set by the owner). Not yet done: deploy this code, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, one real small payment per provider.

## Billing system, 22 Nov 2026 (trial, monthly/yearly, coupons)

**What a customer sees.** Landing page and signup: "Start your 5-day free trial". In the app: a pill "Free trial · ends in 3 days" in the header (links to Plan and billing),
a prompt on the dashboard for people who can still take the trial, and on Plan and billing: provider (Razorpay in India, PayPal elsewhere), monthly or yearly with
the yearly saving, an optional promo code, and the exact terms (what is charged, when, how to cancel). Cancelling during the trial stops the first charge at the provider
and keeps access to the trial end.

**How it works.**
- A trial is a real subscription whose first charge is deferred: Razorpay `start_at` = now + trial days (the ₹5 authentication charge is never recorded as a purchase and its
  refund never ends access); PayPal uses a plan that begins with a free cycle. Access during the trial runs to the first-charge date; the first successful charge extends it
  by a month or year through the usual webhooks. One trial per person (a person whose subscription ever started pays from day one).
- Plans: `RAZORPAY_PLAN_ID_ONE_MONTHLY/YEARLY`; PayPal `PAYPAL_PLAN_ID_ONE_MONTHLY/YEARLY` (no trial, for returning customers) and `..._MONTHLY_TRIAL/_YEARLY_TRIAL` (5-day trial).
  Every plan is read back from the provider before a customer is sent to it and must match the advertised trial length and be priced per period.
- **Coupons** (migration 13): `trial_days` codes, e.g. a code on an Instagram ad that gives 30 days free instead of 5. Rules: new subscribers only, once per person, optional
  limit and start/end dates, per-period, 20 attempts per person per hour, and a code is used up only when the subscription that used it actually starts. Create and manage
  them with `node scripts/billing/coupon.mjs create --code INSTA30 --days 30 --campaign instagram --max 500 --until 2026-12-31 --paypal --live`
  (also `list`, `disable --code X`). `--paypal` creates the matching PayPal plans (sandbox unless `--live`); without it the code works on Razorpay only.
  Needs `SUPABASE_SERVICE_ROLE_KEY`. A percentage-off code type needs per-provider discount objects (Razorpay offers, PayPal discount plans) and is not built yet.
- Razorpay webhook events: payment.captured/failed, refund.created/processed and all `subscription.*`.

**Not built / limits.** Switching an active subscription between monthly and yearly (cancel at the period end and subscribe again for now); percentage-off codes; an admin
screen for coupons (use the script; platform admins can read the tables); automatic emails (Razorpay and PayPal send their own payment emails).

**Apply order.** Migrations 11, 12, then 13 (`supabase/migrations/20261122000013_billing_coupons.sql`; rollback in `supabase/rollback`, roll back 13 first).
