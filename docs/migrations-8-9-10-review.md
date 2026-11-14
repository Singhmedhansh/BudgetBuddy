# Migrations 8, 9 and 10: review before applying

> **Update, 14 November 2026:** the owner approved 8 then 9, and both were applied to the live project (recorded as
> `budgetbuddy_shared_spaces_and_hardening` and `budgetbuddy_profile_settings_ai_entitlements`). Verified afterwards: the
> avatar bucket and its 4 policies exist, the old `members_manage` policy is gone, 0 unbalanced transactions, and the
> previously skipped settings and shared-space tests pass. **Migration 10 is still not applied.**

Status of the live Supabase project `glgpgmptugomfxoteyys`, checked by read-only queries on 14 November 2026.

| Migration | File | Live? |
|---|---|---|
| 1 to 7 | `20261113000001` to `...007` | Applied |
| 8 | `20261113000008_shared_spaces_and_hardening.sql` | **Not applied** |
| 9 | `20261113000009_profile_settings_ai_entitlements.sql` | **Not applied** |
| 10 | `20261113000010_concurrency_guards.sql` | **Not applied** (new, written by this audit) |

None of these has been applied. Applying any of them needs explicit owner approval.

**Order matters.** 9 replaces a function created in 8 and reads a table created in 8, so it fails without 8. 10 depends on nothing in 8 or 9 and can go in either order, but apply 8, 9, 10 in sequence.

All three touch only the `budgetbuddy` schema, plus one new private storage bucket and its four policies. None touches `public` (HireCheck), `auth`, or another product's storage bucket.

## Why migration 8 is the most important

The live database today still has the original membership and ledger rules, which migration 8 was written to fix. These were found by the earlier audit and have regression tests that pass in-process, **but the fixes are not live**:

1. `members_manage` still lets an admin delete or demote the **owner** and insert arbitrary users as members.
2. An editor can still change a posted transaction's status or authorship fields.
3. An editor can still append extra ledger entries to an existing posted transaction.
4. Reversing an expense that has an active refund is still allowed, which leaves net spending negative.

The practical exposure today is small, because the invitation functions do not exist live, so spaces have a single member (the owner) and nobody else holds a role to abuse. It becomes real the moment second members exist, so apply migration 8 **before** opening sign-ups or shared spaces to anyone.

It also means **shared spaces do not work on the live project**: `space_invites` and every invite, member, role and removal function are missing, so inviting, accepting, role changes and removing members all fail live.

### What migration 8 does
- Drops the `members_manage` policy and revokes direct insert/update/delete on `financial_space_members`. Every membership change goes through functions that enforce the role hierarchy.
- Replaces `protect_posted_transaction` so a posted row is frozen apart from merchant, description and notes.
- Adds a trigger so ledger entries can only be inserted in the same database transaction that created the header.
- Replaces `reverse_transaction` to refuse while a refund is still active.
- Adds table `space_invites` with RLS (admins read only), and functions `create_invite`, `revoke_invite`, `accept_invite`, `list_members`, `set_member_role`, `remove_member`, `delete_my_data`. All are `security definer` with `search_path = ''`, execute revoked from `public`/`anon`, granted to `authenticated`.

### Risks in migration 8
- `delete_my_data` (replaced by migration 9) disables and re-enables the `transactions_protect_posted` trigger. `ALTER TABLE ... DISABLE TRIGGER` takes an `ACCESS EXCLUSIVE` lock on `budgetbuddy.transactions` for the length of the call, which briefly blocks every user's reads and writes to that table. If anything fails inside, the whole transaction rolls back and the trigger stays enabled. Fine at current scale; worth revisiting before many users.
- It deletes the caller's `audit_logs` rows. Migration 9 replaces that with setting `actor = null`, which keeps the audit trail. Another reason to apply 8 and 9 together.
- No existing rows are rewritten.

## Migration 9

### What it does
- Adds nine columns to `budgetbuddy.profiles` (avatar path, phone, country, date format, number format default `en-IN`, profile completion timestamp, banner dismissal, dashboard and notification preference JSON), with CHECK constraints. All are nullable or have a default; nothing is rewritten.
- Creates private bucket `budgetbuddy-avatars` (2 MB, JPEG/PNG/WebP) with four policies that confine each person to their own folder. A CHECK also stops a profile pointing at another person's file.
- Adds `financial_spaces.is_sample` and `delete_sample_space`, which can remove only sample data, by its sole owner.
- Adds `transfer_ownership` (the previous owner stays as admin) and `deletion_blockers`.
- Replaces `delete_my_data` with a fuller version: refuses while the person owns a space others use, deletes spaces they solely own, removes them from others, sets `audit_logs.actor` to null instead of deleting audit rows, and removes their support, feedback, AI-usage and entitlement rows.
- Adds `ai_usage` (RLS: read own) with `ai_reserve` and `ai_settle`, which reserve a call before it is made under an advisory lock so concurrent calls cannot race past a limit.
- Adds `entitlements` (RLS: read own; written only by the billing webhook with the service role) and `payment_events` (no client access; idempotency for webhooks).

### Risks in migration 9
- Same `ACCESS EXCLUSIVE` lock note for `delete_sample_space` and `delete_my_data`.
- Adding `number_format ... not null default 'en-IN'` is a constant default, so on PostgreSQL 11+ it is a metadata-only change and does not rewrite the table.
- Storage policies are named `budgetbuddy avatars ...`, which do not collide with HireCheck's.
- It unlocks features that depend on it: profile photo upload, profile completion persistence, preferences, sample data, ownership transfer, account deletion, AI limits and plan entitlements. Until applied, the app shows honest messages and disables those controls.

## Migration 10 (new)

Found by this audit; see `src/db/concurrency.test.ts`.

1. **Refund limit race.** `post_transaction` summed existing refunds and compared them to the original expense without locking anything. Two refunds submitted at once could each pass and together exceed the amount spent. The original row is now locked with `FOR UPDATE`.
2. **Double reversal race.** `reverse_transaction` checks "already reversed" and then inserts, with no lock, so two simultaneous reversals could both post. A partial unique index `transactions_one_reversal` on `(reversal_of)` now makes the database refuse the second.

Effects: no data changes. The live data already satisfies the index (checked: 568 transactions, 0 originals with more than one reversal, 0 unbalanced transactions, 0 over-refunded expenses). The grants on `post_transaction` are re-applied unchanged.

**What the tests prove, and what they do not.** The in-process database is a single connection, so it cannot reproduce two requests racing. The tests prove the two things that make the race safe: the database itself rejects a second reversal row, and the refund check takes `FOR UPDATE` before comparing. A real concurrent test needs the live database after approval.

## Recommended sequence, when approved
1. Apply 8, then run the live checks (`E2E_MIGRATION8=1`).
2. Apply 9, then run the settings suite. It detects the new profile columns by itself, so the 11 tests that skip today will run.
3. Apply 10.
4. Run the full suite again, plus a read-only integrity query: unbalanced transactions, duplicate reversals, over-refunds should all be zero.

Rollback: none of these is destructive, but there are no down migrations. Take a backup first.
