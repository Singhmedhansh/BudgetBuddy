# FinTrack

**Your finances. In focus.**

FinTrack is a personal finance app: accounts, transactions on a double-entry ledger, budgets, goals, bills and
subscriptions, CSV import, shared spaces, and a grounded assistant (off until credentials exist). Built with Next.js 16
(Cache Components, `proxy.ts`), TypeScript, Tailwind v4 and Supabase.

| Plan | Price |
| --- | --- |
| FinTrack Free | ₹0 |
| FinTrack One | ₹149 / month, or ₹1,199 / year |

Prices and plan names live in one place, [src/config/plans.ts](src/config/plans.ts). Live payments are disabled in code;
see [docs/ai-and-payments.md](docs/ai-and-payments.md).

## Run it

```bash
cp .env.example .env.local   # then fill in the Supabase values
npm install
npm run dev                  # http://localhost:3100
```

| Command | What it does |
| --- | --- |
| `npm test` | Unit and database tests (Vitest, with PGlite running the real migrations) |
| `npm run lint` / `npm run typecheck` | ESLint and TypeScript |
| `npm run build` | Production build |
| `npx playwright test` | End-to-end suite. `E2E_PROD=1 E2E_PORT=3200` runs it against `next start` |

## Configuration

Environment variables are documented in [.env.example](.env.example). Provider setup (Google, GitHub, magic links) is in
[docs/auth-providers.md](docs/auth-providers.md); AI and payments in [docs/ai-and-payments.md](docs/ai-and-payments.md).
The brand, logo and the identifiers that deliberately did not change are in [docs/brand.md](docs/brand.md).

The public site URL is read from `NEXT_PUBLIC_SITE_URL` only. No domain is hard-coded, so the final domain is a one-line
change once it is chosen.
