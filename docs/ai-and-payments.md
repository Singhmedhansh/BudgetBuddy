# AI assistant and payments: how to switch them on

Both are built and tested but **off**. Nothing calls an AI provider or takes a payment until you add credentials.
No credential is stored in the repository; `.env.example` lists every variable with an empty value.

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

Model catalogues move. Both defaults this project originally shipped with were **retired by their providers in 2026**
(`gemini-2.0-flash` on 1 June, `llama-3.3-70b-versatile` on 16 August), so the assistant would have failed the moment it
was switched on. The defaults are now ordered lists: Gemini `gemini-3.6-flash`, then `gemini-3.5-flash`; Groq
`openai/gpt-oss-120b`, then `qwen/qwen3.6-27b`. These were taken from the providers' deprecation pages, and snapshots of
those pages disagreed with each other, so they have **not been verified against a live key**. Run:

```
npm run ai:models              # lists which configured names each provider offers today
npm run ai:models -- --smoke   # plus one tiny prompt per provider (about 20 output tokens)
```

and set `GEMINI_MODEL` / `GROQ_MODEL` to whatever it reports. A model the provider says is gone is rested for 30 minutes
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
4. Register webhooks: Razorpay → `https://<host>/api/webhooks/razorpay` (subscription.*, payment.captured/failed,
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

### Known limits

- Razorpay `payment.*` events carry no subscription, so a failed **renewal** is reflected through `subscription.pending`
  / `halted` (status past due), not as a ledger row. Refunds are matched by payment id.
- PayPal refunds are not matched to ledger rows (PayPal's sale id is not exposed on the subscription); they are in
  PayPal's own records.
- PayPal payments are keyed `subscription:payment time` because the subscription API does not return the sale id.
- Billing rows are financial records and are **not** removed by "delete my data" (migration 12 header). Retention is an
  owner decision to confirm with the privacy policy.
- No sandbox or live credentials were available while this was built, so provider calls are covered by mocked-response
  tests only. Run the sandbox checkout end to end before going live.
