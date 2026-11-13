# AI assistant and payments: how to switch them on

Both are built and tested but **off**. Nothing calls an AI provider or takes a payment until you add credentials and
the switch described below. No credential is stored in the repository.

## AI assistant

All AI calls run on the server. Keys are read from server-only environment variables (no `NEXT_PUBLIC_` prefix), are
never sent to the browser, and are never written to logs or error messages. A test scans the production browser
bundle for the variable names.

| Variable | Purpose | Default |
| --- | --- | --- |
| `AI_ENABLED` | Master switch. Must be exactly `true`. | off |
| `GEMINI_API_KEYS` | Comma-separated Google Gemini keys | none |
| `GROQ_API_KEYS` | Comma-separated Groq keys | none |
| `AI_PROVIDER_ORDER` | Which provider is tried first | `groq,gemini` |
| `GEMINI_MODEL`, `GROQ_MODEL` | Model ids | `gemini-2.0-flash`, `llama-3.3-70b-versatile` |
| `AI_REQUESTS_PER_HOUR` | Per person | 20 |
| `AI_TOKENS_PER_DAY` | Per person, prompt plus answer | 60000 |
| `AI_MAX_OUTPUT_TOKENS` | Cap on each answer | 700 |
| `AI_MAX_QUESTION_CHARS` | Longest question accepted | 600 |

To enable: add your keys and `AI_ENABLED=true` to `.env.local`, apply migration 9 (it holds the usage table and the
limit functions), and restart. The Assistant page then accepts questions.

### How keys are used

- Keys are **failover, not rotation**. One key is used until it fails. A rate-limited key rests for the time the
  provider asks (capped at five minutes), a bad credential rests for fifteen minutes, a server error for thirty seconds.
- At most **three upstream calls** are made for one question, across all keys and both providers. A bad request is not
  retried on other keys.
- Per-person limits are checked and **reserved in the database before any call**, under a per-person lock, so parallel
  requests cannot slip past them and extra keys cannot be used to exceed them.

### Why it cannot invent figures

The model is given only a JSON summary computed from the ledger (net worth, balances, this month, top categories,
budgets), the same numbers the dashboard shows. It never sees individual transactions. Every amount and percentage in
its answer is checked against that summary. If any figure is not in it, the answer is discarded and the person gets a
plain summary built from the verified figures instead.

## Payments

Live payments are disabled **in code** (`LIVE_PAYMENTS_ALLOWED` is a constant), so no environment variable can turn
real charging on. Sandbox is the only mode. The existing pricing in `src/config/plans.ts` is untouched.

| Variable | Purpose |
| --- | --- |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Razorpay sandbox API credentials |
| `RAZORPAY_WEBHOOK_SECRET` | Verifies webhook signatures |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` | PayPal sandbox credentials |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. Lets the webhook write entitlements. |

What exists today:

- A plan **entitlement** model: Free, a paid period, a trial, a seven-day grace period after a failed renewal, and a
  cancelled plan that runs to the end of the period already paid. Missing or malformed billing data always resolves to
  Free, so a gap can never grant paid access.
- A Razorpay **webhook** at `/api/webhooks/razorpay`. It answers 503 until the secret and service key exist. After that
  it verifies the HMAC signature on the raw body, processes each event id once, and only ever updates the
  `entitlements` table.
- Checkout is not built yet, because it cannot be tested without credentials.
