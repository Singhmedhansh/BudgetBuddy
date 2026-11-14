# FinTrack brand

- **Name:** FinTrack. **Tagline:** Your finances. In focus.
- **Plans:** FinTrack Free (₹0) and FinTrack One (₹149 / month, ₹1,199 / year).
- **Colour:** forest green `#245C48` (`--primary`), with the existing ivory, sage and deep-ink tokens in `src/app/globals.css`.
- **Type:** Fraunces (display, wordmark) and Hanken Grotesk (text).

Text and identity are set in one place: [src/config/brand.ts](../src/config/brand.ts) (name, tagline, description) and
[src/config/plans.ts](../src/config/plans.ts) (plan names and prices). Components read from those; do not repeat them.

## Logo

The symbol is an "F" made from a stem that carries two lines out to connected points, the upper one lighter. It reads as
tracking money from one place to another, with the information held in a single frame. It avoids currency, coin and chart
clichés. The wordmark sets "Fin" in Fraunces Light and "Track" in Fraunces SemiBold.

| Asset | Use |
| --- | --- |
| `src/components/brand/Logo.tsx` | `LogoMark`, `Wordmark`, `Logo` (`compact` = symbol only). Uses theme tokens, so it follows light and dark |
| `public/brand/fintrack-logo.svg`, `fintrack-logo-dark.svg` | Full lock-up for light and dark backgrounds |
| `public/brand/fintrack-mark.svg`, `fintrack-mark-dark.svg` | Symbol alone |
| `src/app/icon.svg` | Favicon |
| `src/app/apple-icon.tsx` | Home-screen icon (180 px PNG, generated) |
| `src/app/manifest.ts` | Web app manifest |
| `src/app/opengraph-image.tsx` | Social preview image |

## Internal identifiers that keep the old name

The product was first built as "Budget Buddy". The public name changed; these internal identifiers did not, because
renaming them needs migrations or signs people out, and nothing a customer sees depends on them:

| Identifier | Why it stays |
| --- | --- |
| `budgetbuddy` Postgres schema, tables, functions, migrations | Changing it means a schema rename and rewriting every migration and policy |
| Storage buckets `budgetbuddy-receipts`, `-imports`, `-avatars`, `-support` | Existing objects and storage policies reference them |
| Auth cookie `sb-budgetbuddy-auth-token` | Renaming signs everyone out. It also keeps sessions separate from HireCheck on the shared project |
| `BUDGETBUDDY_DELETE_AUTH_USER` env var | An existing configuration name; no reason to break setups |
| Plan id `pro` (stored in `entitlements.plan`) | A database value, constrained by a CHECK. Only the display name changed to FinTrack One |
| Git history, the repository folder name | History is preserved |
| Browser storage keys `bb-theme`, `bb-space` and cookie `bb-last-provider` | Renaming resets saved themes and active spaces for existing browsers |
| `type BudgetBuddyClient` in `src/server/ledger-write.ts` | An internal type alias |

## Domain

The official domain is `https://getfintrack.online`. Vercel project `fintrack` has the apex and `www` domains attached
to the `feat/budget-buddy-v1` Preview branch. Production remains unconfigured and is not assigned either domain.

The site metadata uses the official origin for Production and for that branch's Preview deployment. Authentication
email callbacks use the explicit `NEXT_PUBLIC_SITE_URL` when configured and otherwise use the request's host. Before
enabling authentication on the custom domain, add `https://getfintrack.online/**` to the Supabase Auth redirect
allow-list; this project setting has not been changed. The `www` host redirects to the apex in the app once the branch
is redeployed with the current source changes.
