<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Product

The product is **FinTrack** ("Your finances. In focus."), with plans FinTrack Free and FinTrack One. Name, tagline and
plan prices live in `src/config/brand.ts` and `src/config/plans.ts`; never hard-code them in components. The internal
identifiers that kept the earlier name (the `budgetbuddy` schema, buckets, auth cookie, plan id `pro`) are listed in
`docs/brand.md` and must not be renamed for branding reasons.
