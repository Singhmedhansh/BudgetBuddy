# FinTrack v1.0 pre-launch audit

Audit date 14 November 2026. Branch `feat/budget-buddy-v1`. Everything below was checked against the code, the live
Supabase project (read-only queries) and running builds. Where something was not tested, it says so.

## 0. Baseline (what was true when the audit started)

- Branch `feat/budget-buddy-v1`, HEAD `ed769d8`. The working tree held uncommitted SEO work by someone else (origin helper,
  www redirect, robots/sitemap edits); it was reviewed, completed and committed.
- Preview deployment `fintrack-b95y1ktu5` was built from `6acca1d`. Vercel project `fintrack`, team `medhansh-s-projects`.
  The domains `getfintrack.online` and `www.getfintrack.online` are attached to the project and Vercel aliases them to the
  newest Preview deployment. The domain's nameservers (`*.dns-parking.com`) do **not** point at Vercel, so the domain does
  not serve traffic yet. No DNS was changed.
- One deployment is assigned to **Production** (`fintrack-3opeigch4`): Vercel promotes a project's first deployment
  automatically, which happened before this audit. It has no Supabase environment variables, so it serves public pages and
  cannot sign anyone in or touch data. It was not touched by this audit. It is the owner's decision whether to delete it.
- Live database: migrations 1 to 7 applied; **8 and 9 not applied** (see section 6).
- Baseline checks: 481 of 482 unit tests passed; the failure was a brand-guard test tripping over a branch name in the new
  origin helper, and vitest was also collecting the hosted Playwright specs. Both fixed.

## 1. SEO

**Implemented**

- One module, `src/config/seo.ts`, builds metadata for every public page: unique title, unique description, canonical URL,
  Open Graph (type, URL, site name, locale `en_IN`, image 1200 by 630 with alt text) and Twitter card
  (`summary_large_image`). A page that sets its own Open Graph block replaces the layout's, so the helper writes the whole block.
- A latent bug was removed: the root layout set `canonical: "/"`, which made any page without its own canonical claim the
  home page.
- Home title is exactly `FinTrack — Your Finances. In Focus.` and its description is the one requested. The page language is `en-IN`.
- Public indexable pages: home, Help Centre, 23 help articles, Security, Contact, 6 legal documents (33 URLs). All have
  distinct titles and descriptions, enforced by a unit test. Three legal summaries were too thin to be descriptions and
  were rewritten.
- `noindex`: sign-in, sign-up, forgot and reset password, link-error, and the whole signed-in app (metadata in the app
  layout plus an `X-Robots-Tag: noindex, nofollow` header on `/app`, `/api` and `/auth`, so redirects and CSV downloads
  are covered too).
- `robots.txt` allows `/` and blocks `/app`, `/api/`, `/auth/`. Sign-in and sign-up are deliberately **not** blocked so a
  crawler can read their `noindex` tag. `sitemap.xml` lists only the 33 public pages, with priorities and change
  frequencies, and no `lastmod` (the content has no reliable modified date, so none is claimed).
- Social image: a redesigned 1200 by 630 card using the FinTrack mark and wordmark, the tagline and the domain, served at
  `/opengraph-image` and `/twitter-image`.
- Structured data on the home page: `Organization`, `WebSite` and `SoftwareApplication`, with a free `Offer` only. No
  ratings, reviews, awards or counts. FinTrack One is not described as an offer because it cannot be bought yet.
- Origin: `src/config/site-origin.ts` picks `SEO_CANONICAL_ORIGIN`, then `NEXT_PUBLIC_SITE_URL`, then the official domain in
  Production, then the deployment's own address, then localhost for local development only. The Vercel Preview
  environment now has `SEO_CANONICAL_ORIGIN=https://getfintrack.online`.
- `www` to apex: a 308 in `src/proxy.ts`, preserving path and query.

**Validated** (against the hosted Preview deployment and a local production build)

- 18 hosted checks read the real rendered HTML: titles, descriptions, canonicals, Open Graph and Twitter tags, `robots`
  meta, language, no `localhost`, no old product name, structured data parses, `robots.txt`, `sitemap.xml` (every URL
  in it returns 200), icons, manifest, social images, a real 404. All pass.
- `www` redirect: verified on a production build (308 to the apex with path and query preserved; apex serves 200). **Not
  verified on the live domain**, because DNS does not point at Vercel and this machine's network filter blocks direct
  requests to Vercel's edge.

**Remaining indexing tasks (owner)**: point the domain's nameservers or records at Vercel, add the domain to Google Search
Console, submit the sitemap, check the redirect and certificate on the live host, and promote to Production when ready.
Search Console configuration and submission were not done.

## 2. Feature audit

Status key: COMPLETE implemented and tested end to end; PARTIAL; BROKEN; MISSING; BLOCKED on a credential, migration or setting.

| Feature | Status | Tests performed | Remaining issues |
|---|---|---|---|
| Login, logout, session persistence, expiry, redirects, account isolation | COMPLETE | 13 auth E2E, 7 session-isolation unit tests | None |
| Registration, email verification | BLOCKED | Validation only (every error, nothing created) | A real sign-up creates a user in the shared Supabase project and depends on its email-confirmation setting; not run to avoid touching HireCheck |
| Password reset | PARTIAL | Same answer for real and unknown email; invalid, expired and missing tokens; recovery guard unit tests | The emailed link end to end needs the redirect allow-list (not changed) |
| Magic link | PARTIAL | Uniform response, bad-code callback | Link flow untested for the same reason |
| Google and GitHub sign-in | BLOCKED | Buttons hidden while providers are disabled | Providers are off in Supabase |
| Profile creation | COMPLETE | Onboarding and profile tests | None |
| Profile completion, preferences, photo, sample data | BLOCKED | 11 E2E tests skipped; in-process DB tests pass | Needs migration 9 |
| Dashboard | COMPLETE | Figures reconcile with the raw ledger; empty states; "Coming up" and "Savings goals" panels added and tested; preferences | No generated insights (assistant is off) |
| Accounts | COMPLETE | Create, rename, archive (refused with money in it), restore, history kept, hidden from new transactions | One currency per space; no multi-currency accounts |
| Transactions | PARTIAL | Create all three types, search, filters, sort, pagination, duplicate submit, edit details, reversal | **Receipt attachments are MISSING** (bucket and policies exist, no UI and no column linking a receipt) |
| Transfers and refunds | COMPLETE | Transfer not counted as spending; refund caps; reversal history; ledger reconciliation | Refund and reversal race guards are in migration 10 (not applied) |
| Budgets | COMPLETE | Create, edit, archive; 0, 50, 80, 100, 108 and 150 percent; rollover rules (unit) | None |
| Savings goals | COMPLETE | Create, add, take out, **edit (new)**, pause, complete, archive. A real bug was found and fixed (below) | DB-level guard is in migration 10 (not applied) |
| Bills | COMPLETE | Create, appears on calendar, marked paid once, no duplicate | No edit after creation (pause or stop only) |
| Subscriptions | COMPLETE | Create, paid once, pause, resume, cancel | No edit after creation |
| Expected income | COMPLETE | No balance change until received; then exactly once | None |
| Notifications for upcoming bills | MISSING | Choices persist | No email or push delivery exists; the page says so |
| Analytics and reports | PARTIAL | Income, spending and a transfer move the totals exactly; custom, empty and malformed ranges; CSV and JSON export | No PDF or scheduled reports |
| Calendar | COMPLETE | Month navigation, malformed month, bill appears, mobile viewport | None |
| Debt and liabilities | PARTIAL | Terms save and persist, bad values refused, balance unchanged | No separate payment-history page (repayments are transfers in Transactions) |
| Shared spaces and members | BLOCKED | 14 in-process DB tests pass; E2E skipped | **Invitations, roles and removal do not exist on the live database** (migration 8) |
| CSV import | PARTIAL | Preview, skip a bad row, confirm, retry creates nothing, error report | Header-based detection only; no manual column mapping, no OFX or XLSX |
| Export | COMPLETE | Header, ledger match, formula neutralised, bad range is a 400, JSON has no secrets | None |
| Profile and settings | PARTIAL | Password, connected accounts, notifications, privacy, deletion safeguards | Photo, preferences, deletion need migration 9 |
| Help Centre and support | COMPLETE | Every internal link resolves, search, articles; contact validation; DB rate limits | None |
| AI assistant | BLOCKED | 36 unit tests; disabled, sends nothing | No Gemini or Groq credentials |
| Payments | BLOCKED | 18 unit tests; live payments off in code | Razorpay webhook verification and idempotency exist; PayPal webhook, refund events, billing history and invoices do **not**; no checkout |

### Bug found by this audit: space switcher unusable with many spaces
The space menu had no height limit and the sidebar clipped it, so with enough spaces the ones below the fold could not be
selected. Fixed: the list scrolls and the Members and New shared space links stay visible.

### Bug found by this audit: goal over-withdrawal
"Take out 99,999" from a goal holding 2,000 was **recorded**, leaving the goal at minus 97,999 while the page showed 0
percent. The test meant to prove it was refused passed by accident: it matched Next.js's empty route-announcer alert and read
the progress bar before the redirect arrived. Fixed in the app (refused with the amount that can be taken out), in migration 10
(a database trigger), and the test now checks the message and the stored data. Live data: 12 goals are negative, all in
disposable test spaces, none in real data.

## 3. Financial correctness

- **Representation.** Money is integer minor units in `bigint` columns with `amount > 0` checks; user input is parsed with exact
  decimal arithmetic that refuses extra decimals rather than rounding. Remaining floats are display percentages and an
  interest rate rounded to basis points.
- **Ledger.** Every transaction's entries must sum to zero, enforced by a deferred trigger and by the posting function.
  Live check: 568 transactions, 0 unbalanced, 0 with duplicate reversals, 0 over-refunded.
- **Atomicity.** Posting, reversing, settling and import commit are single database calls.
- **Idempotency.** Imports use a unique `(space, source, external_id)` constraint (retry tested: nothing new recorded);
  recurring settlement is unique per `(item, due_date)`; the webhook inserts the event id first.
- **Transfers and card repayments** are never income or spending (tested against the raw ledger and in analytics).
- **Found and fixed (files only, not applied):** refund-limit race, double-reversal race, goal over-withdrawal. See migration 10.
- **Remaining risks:** the race fixes cannot be proven under real concurrency until migration 10 is applied to a real
  database (the in-process test engine has one connection). `delete_my_data` takes a table lock that briefly blocks all users.

## 4. Security

- **Cross-user isolation.** Tested in-process against the real migrations (RLS: non-members see nothing, cannot write by
  guessing ids, viewers cannot write, private accounts hidden, profiles are self-only, audit log not writable). **No second
  real account was used on the live project**, so cross-user isolation is proven on the schema and policies, not with two live
  sessions.
- **Live gap.** The membership and ledger hardening in migration 8 is not on the live database (an admin can still delete or
  demote an owner; an editor can append entries to a posted transaction). Exposure is limited today because no second member
  can exist, but it must be applied before sharing opens.
- **Authentication.** Own cookie name separate from the HireCheck app; recovery cookie is signed and the app fails closed without
  its secret; same message for known and unknown emails; open-redirect guarded. Auth rate limits come from Supabase Auth.
- **Storage.** Buckets are private with size and type limits; policies scope by space and by user; traversal paths denied. Uploads
  are validated by file signature, size, extension and a sanitised name.
- **Webhook.** HMAC verified in constant time on the raw body, answers 503 until configured, event ids processed once.
- **Rate limiting.** Database-enforced for support and help; reserved before the call for AI.
- **Other.** Security headers present (nosniff, frame deny, HSTS, referrer and permissions policies). No Content-Security-Policy yet.
  No secrets in the repository or the browser bundle (test-enforced).
- **Remaining:** add a CSP; apply 8 first; run a two-account live isolation test after a second test account is approved.

## 5. Test results

| Check | Result |
|---|---|
| Unit and in-process database tests (Vitest) | **507 passed, 0 failed**, 43 files. Database 124, domain 119, server 89, app 92, lib 49, config 26, content 8 |
| End-to-end, local production build (Playwright, 4 viewports: 1440, 1280, 768, 390) | **308 passed, 0 failed, 12 skipped** |
| Hosted checks against the Preview deployment | **29 passed, 0 failed**: SEO 18, smoke 7, phone layout 2 (run in both a desktop and a phone project) |
| ESLint | Clean, no warnings |
| TypeScript | 0 errors |
| Production build | Succeeds; all routes compile, including the new `/app/goals/[id]/edit`, `/twitter-image` |

**The 12 skipped tests, and why.** None was skipped to make a number look better; each needs something that is not live.
- 11 need **migration 9** (profile completion, preferences, sample data, avatar, and the two account-deletion tests). The settings
  suite probes for the new columns and runs them automatically once they exist.
- 1 needs **migration 8** (reversing an expense that still has a refund must be refused). It runs when `E2E_MIGRATION8=1`.

**What was added.** SEO: 14 unit tests and 18 hosted checks. Financial: 9 migration-10 tests. Journeys: 16 new E2E tests
(accounts, subscriptions, expected income, debt, CSV import and export, transaction edit, calendar, analytics, contact
validation) plus extended goal and bill journeys. All money assertions compare against an independent sum of the raw ledger.

**Two problems the test work uncovered in the tests themselves.**
- The goals "over-withdraw refused" assertion was vacuous (above). It now checks the message and the stored data.
- The first full run showed Journey A and the budget-threshold test failing, and a re-run of the same specs alone passed.
  Reproduced it: the disposable test user had accumulated dozens of spaces and the **space switcher menu had no height
  limit**, so spaces below the fold could not be clicked. That is a genuine product defect for anyone with many spaces; the
  list now scrolls on its own and the journeys pass in the full run.

**Not tested, stated plainly.** Real registration and email delivery, the emailed reset and magic links, social sign-in,
anything needing migration 8 or 9 on the live project, two simultaneous live sessions for cross-user isolation, true
concurrent requests, and any payment or AI provider call.

## 6. Blocked dependencies

See `docs/migrations-8-9-10-review.md` for the exact effects of each migration. **No migration was applied.**

| Item | State | What it blocks |
|---|---|---|
| Migration 8 | Not applied. Approval required. | Shared spaces, invitations, member management, the membership and ledger hardening, one skipped test |
| Migration 9 | Not applied. Approval required. Needs 8 first. | Profile photo, profile completion and preferences, sample data, ownership transfer, account deletion, AI limits, entitlements, 11 skipped tests |
| Migration 10 | Written by this audit, not applied. | The refund, reversal and goal race guards |
| Supabase Auth | Redirect allow-list not changed; Google and GitHub off | Emailed links on the custom domain; social sign-in |
| DNS | Nameservers do not point at Vercel; not changed | The custom domain serving traffic |
| Gemini and Groq keys | Not provided | The assistant (stays disabled) |
| Razorpay and PayPal credentials | Not provided | Checkout, webhooks, billing |

## 7. Next steps before public launch

1. Approve and apply migrations 8, 9 and 10 in order (take a backup first), then re-run the suite; 12 skipped tests should run.
2. Decide on the stray Production deployment (delete it, or leave it) and keep Production unassigned until launch.
3. Point DNS at Vercel; confirm the certificate, the `www` redirect and the canonical host; add the Supabase redirect allow-list
   entries and set `NEXT_PUBLIC_SITE_URL`.
4. Decide the email-confirmation policy for the shared Supabase project, then test real registration and reset by email.
5. Provide Razorpay and PayPal sandbox credentials; build checkout, PayPal webhook, billing history and invoice records
   (these need a migration); test with real sandbox transactions.
6. Provide AI keys; test grounding with real answers.
7. Add receipts (needs a column or table), bill and subscription editing, notification delivery, and a Content-Security-Policy.
8. Authorise cleanup of test data (disposable test user, its spaces, the stray support request and feedback row) and verify
   HireCheck is untouched.
9. Legal review of the policy documents, then Search Console.
