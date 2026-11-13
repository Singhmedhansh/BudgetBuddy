-- Budget Buddy core schema: identity, financial spaces, accounts, categories,
-- double-entry ledger, budgets. Lives in its own `budgetbuddy` schema because it
-- shares a Supabase project with unrelated products.
--
-- Design constraints that follow from the shared project:
--   * No objects are created in `public` and no trigger is added to `auth.users`
--     (an unrelated `on_auth_user_created` trigger already exists there).
--     Profiles are created by the explicit, idempotent `budgetbuddy.ensure_profile()`.
--   * The `budgetbuddy` schema must be added to the project's exposed Data API
--     schemas before the browser/server clients can reach it (see docs).
--
-- Money is stored as bigint minor units plus an explicit ISO currency code.

create schema if not exists budgetbuddy;

-- Never reachable without going through RLS-protected objects.
revoke all on schema budgetbuddy from public, anon;
grant usage on schema budgetbuddy to authenticated, service_role;

-- ───────────────────────── enums ─────────────────────────
create type budgetbuddy.space_role as enum ('owner', 'admin', 'editor', 'viewer');
create type budgetbuddy.space_kind as enum ('personal', 'couple', 'family', 'household', 'roommates');
create type budgetbuddy.account_type as enum
  ('savings', 'current', 'cash', 'credit_card', 'wallet', 'investment', 'other_asset', 'other_liability');
create type budgetbuddy.ledger_kind as enum ('asset', 'liability', 'expense', 'income', 'equity');
create type budgetbuddy.txn_type as enum ('expense', 'income', 'transfer', 'refund', 'adjustment');
create type budgetbuddy.txn_status as enum ('posted', 'pending', 'reversed');
create type budgetbuddy.txn_source as enum ('manual', 'import', 'integration');

-- ───────────────────────── identity ─────────────────────────
create table budgetbuddy.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  persona text check (persona in ('student', 'professional', 'household', 'other')),
  currency text not null default 'INR',
  timezone text not null default 'Asia/Kolkata',
  theme text not null default 'light' check (theme in ('light', 'dark', 'system')),
  onboarding_completed_at timestamptz,
  onboarding_state jsonb not null default '{}'::jsonb,
  tour_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────────────────────── spaces ─────────────────────────
create table budgetbuddy.financial_spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  kind budgetbuddy.space_kind not null default 'personal',
  currency text not null default 'INR',
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create table budgetbuddy.financial_space_members (
  space_id uuid not null references budgetbuddy.financial_spaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role budgetbuddy.space_role not null,
  created_at timestamptz not null default now(),
  primary key (space_id, user_id)
);
create index on budgetbuddy.financial_space_members (user_id);

-- ───────────── RLS helpers (security definer, fixed search_path) ─────────────
-- Role rank lets policies ask "at least editor".
create function budgetbuddy.role_rank(r budgetbuddy.space_role) returns int
language sql immutable as $$
  select case r when 'owner' then 4 when 'admin' then 3 when 'editor' then 2 else 1 end
$$;

create function budgetbuddy.has_space_role(p_space uuid, p_min budgetbuddy.space_role)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from budgetbuddy.financial_space_members m
    where m.space_id = p_space
      and m.user_id = (select auth.uid())
      and budgetbuddy.role_rank(m.role) >= budgetbuddy.role_rank(p_min)
  )
$$;
revoke all on function budgetbuddy.has_space_role(uuid, budgetbuddy.space_role) from public, anon;
grant execute on function budgetbuddy.has_space_role(uuid, budgetbuddy.space_role) to authenticated;

-- ───────────────────────── accounts & categories ─────────────────────────
create table budgetbuddy.accounts (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references budgetbuddy.financial_spaces (id) on delete cascade,
  owner_user_id uuid references auth.users (id),   -- set => private to that user within the space
  name text not null check (char_length(name) between 1 and 80),
  type budgetbuddy.account_type not null,
  currency text not null,
  opening_balance bigint not null default 0,       -- minor units, user-facing sign (owed amount for liabilities)
  is_manual boolean not null default true,         -- manual balances are NOT live bank balances
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index on budgetbuddy.accounts (space_id);

create table budgetbuddy.categories (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references budgetbuddy.financial_spaces (id) on delete cascade,
  parent_id uuid references budgetbuddy.categories (id) on delete set null,
  name text not null check (char_length(name) between 1 and 60),
  kind budgetbuddy.ledger_kind not null check (kind in ('expense', 'income')),
  archived_at timestamptz,
  unique (space_id, kind, name)
);
create index on budgetbuddy.categories (space_id);

-- ───────────────────────── ledger ─────────────────────────
create table budgetbuddy.transactions (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references budgetbuddy.financial_spaces (id) on delete cascade,
  type budgetbuddy.txn_type not null,
  status budgetbuddy.txn_status not null default 'posted',
  occurred_at timestamptz not null,                -- UTC instant; display in user's timezone
  recorded_at timestamptz not null default now(),
  currency text not null,
  amount bigint not null check (amount > 0),       -- positive minor units; direction lives in entries
  merchant text,
  description text,
  notes text,
  source budgetbuddy.txn_source not null default 'manual',
  external_id text,                                -- provider/import id for idempotency
  refund_of uuid references budgetbuddy.transactions (id),
  reversal_of uuid references budgetbuddy.transactions (id),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  -- Idempotent imports: the same external id cannot be inserted twice per space.
  unique (space_id, source, external_id)
);
create index on budgetbuddy.transactions (space_id, occurred_at desc);
create index on budgetbuddy.transactions (refund_of) where refund_of is not null;
create index on budgetbuddy.transactions (reversal_of) where reversal_of is not null;

-- One row per ledger leg. `ledger_ref` is an account id or category id.
create table budgetbuddy.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references budgetbuddy.transactions (id) on delete cascade,
  space_id uuid not null references budgetbuddy.financial_spaces (id) on delete cascade,
  account_id uuid references budgetbuddy.accounts (id),
  category_id uuid references budgetbuddy.categories (id),
  amount bigint not null check (amount <> 0),      -- signed: debit +, credit -
  check ((account_id is not null) <> (category_id is not null))
);
create index on budgetbuddy.ledger_entries (transaction_id);
create index on budgetbuddy.ledger_entries (account_id);
create index on budgetbuddy.ledger_entries (category_id);

-- Every transaction's entries must sum to zero. Deferred so all legs can be
-- inserted in one statement/transaction before the check runs.
create function budgetbuddy.assert_transaction_balanced() returns trigger
language plpgsql set search_path = '' as $$
declare s bigint;
begin
  select coalesce(sum(amount), 0) into s
  from budgetbuddy.ledger_entries where transaction_id = new.transaction_id;
  if s <> 0 then
    raise exception 'Transaction % does not balance (sum=%)', new.transaction_id, s
      using errcode = '23514';
  end if;
  return null;
end $$;

create constraint trigger ledger_entries_balanced
  after insert or update on budgetbuddy.ledger_entries
  deferrable initially deferred
  for each row execute function budgetbuddy.assert_transaction_balanced();

-- Posted history is append-only: no deleting or rewriting amounts. Corrections
-- are reversals/adjustments. Only status/notes-style metadata may change.
create function budgetbuddy.protect_posted_transaction() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and old.status = 'posted' then
    raise exception 'Posted transactions cannot be deleted; reverse them instead';
  end if;
  if tg_op = 'UPDATE' and old.status = 'posted' and (
       new.amount is distinct from old.amount or new.currency is distinct from old.currency
    or new.type is distinct from old.type or new.occurred_at is distinct from old.occurred_at
    or new.space_id is distinct from old.space_id) then
    raise exception 'Posted transaction financial fields are immutable; reverse it instead';
  end if;
  return coalesce(new, old);
end $$;

create trigger transactions_protect_posted
  before update or delete on budgetbuddy.transactions
  for each row execute function budgetbuddy.protect_posted_transaction();

-- ───────────────────────── budgets ─────────────────────────
create table budgetbuddy.budgets (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references budgetbuddy.financial_spaces (id) on delete cascade,
  name text not null,
  period text not null check (period in ('weekly', 'monthly', 'annual', 'custom')),
  starts_on date not null,
  ends_on date,                                    -- null for recurring periods
  currency text not null,
  rollover boolean not null default false,
  carry_overspend boolean not null default false,
  warn_at numeric(4, 3) not null default 0.800 check (warn_at > 0 and warn_at <= 1),
  created_by uuid not null references auth.users (id),
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index on budgetbuddy.budgets (space_id);

create table budgetbuddy.budget_allocations (
  budget_id uuid not null references budgetbuddy.budgets (id) on delete cascade,
  category_id uuid not null references budgetbuddy.categories (id) on delete cascade,
  space_id uuid not null references budgetbuddy.financial_spaces (id) on delete cascade,
  amount bigint not null check (amount >= 0),      -- minor units
  primary key (budget_id, category_id)
);

-- ───────────────────────── audit ─────────────────────────
create table budgetbuddy.audit_logs (
  id bigint generated always as identity primary key,
  space_id uuid references budgetbuddy.financial_spaces (id) on delete set null,
  actor uuid references auth.users (id) on delete set null,
  action text not null,
  entity text not null,
  entity_id uuid,
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index on budgetbuddy.audit_logs (space_id, at desc);

-- ───────────────────────── Row Level Security ─────────────────────────
alter table budgetbuddy.profiles enable row level security;
alter table budgetbuddy.financial_spaces enable row level security;
alter table budgetbuddy.financial_space_members enable row level security;
alter table budgetbuddy.accounts enable row level security;
alter table budgetbuddy.categories enable row level security;
alter table budgetbuddy.transactions enable row level security;
alter table budgetbuddy.ledger_entries enable row level security;
alter table budgetbuddy.budgets enable row level security;
alter table budgetbuddy.budget_allocations enable row level security;
alter table budgetbuddy.audit_logs enable row level security;

-- profiles: a user sees and edits only their own row.
create policy profiles_self on budgetbuddy.profiles
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- spaces: members read; owner/admin update; creation goes through create_space().
create policy spaces_read on budgetbuddy.financial_spaces
  for select to authenticated using (budgetbuddy.has_space_role(id, 'viewer'));
create policy spaces_update on budgetbuddy.financial_spaces
  for update to authenticated
  using (budgetbuddy.has_space_role(id, 'admin')) with check (budgetbuddy.has_space_role(id, 'admin'));
create policy spaces_delete on budgetbuddy.financial_spaces
  for delete to authenticated using (budgetbuddy.has_space_role(id, 'owner'));

-- members: members can see co-members; owner/admin manage; role changes never
-- grant more than the actor holds (enforced in the server-side invite flow).
create policy members_read on budgetbuddy.financial_space_members
  for select to authenticated using (budgetbuddy.has_space_role(space_id, 'viewer'));
create policy members_manage on budgetbuddy.financial_space_members
  for all to authenticated
  using (budgetbuddy.has_space_role(space_id, 'admin'))
  with check (budgetbuddy.has_space_role(space_id, 'admin') and role <> 'owner');

-- accounts: viewers read shared accounts; a private account is visible only to its owner.
create policy accounts_read on budgetbuddy.accounts
  for select to authenticated using (
    budgetbuddy.has_space_role(space_id, 'viewer')
    and (owner_user_id is null or owner_user_id = (select auth.uid()))
  );
create policy accounts_write on budgetbuddy.accounts
  for all to authenticated
  using (budgetbuddy.has_space_role(space_id, 'editor')
         and (owner_user_id is null or owner_user_id = (select auth.uid())))
  with check (budgetbuddy.has_space_role(space_id, 'editor')
         and (owner_user_id is null or owner_user_id = (select auth.uid())));

-- Space-scoped tables: viewers read, editors write.
create policy categories_read on budgetbuddy.categories
  for select to authenticated using (budgetbuddy.has_space_role(space_id, 'viewer'));
create policy categories_write on budgetbuddy.categories
  for all to authenticated
  using (budgetbuddy.has_space_role(space_id, 'editor')) with check (budgetbuddy.has_space_role(space_id, 'editor'));

create policy transactions_read on budgetbuddy.transactions
  for select to authenticated using (budgetbuddy.has_space_role(space_id, 'viewer'));
create policy transactions_insert on budgetbuddy.transactions
  for insert to authenticated
  with check (budgetbuddy.has_space_role(space_id, 'editor') and created_by = (select auth.uid()));
create policy transactions_update on budgetbuddy.transactions
  for update to authenticated
  using (budgetbuddy.has_space_role(space_id, 'editor')) with check (budgetbuddy.has_space_role(space_id, 'editor'));
-- No delete policy on transactions: posted history is never deleted from the client.

create policy entries_read on budgetbuddy.ledger_entries
  for select to authenticated using (budgetbuddy.has_space_role(space_id, 'viewer'));
create policy entries_insert on budgetbuddy.ledger_entries
  for insert to authenticated
  with check (
    budgetbuddy.has_space_role(space_id, 'editor')
    -- the entry's space must match its transaction's space (no cross-space smuggling)
    and exists (select 1 from budgetbuddy.transactions t where t.id = transaction_id and t.space_id = ledger_entries.space_id)
  );

create policy budgets_read on budgetbuddy.budgets
  for select to authenticated using (budgetbuddy.has_space_role(space_id, 'viewer'));
create policy budgets_write on budgetbuddy.budgets
  for all to authenticated
  using (budgetbuddy.has_space_role(space_id, 'editor')) with check (budgetbuddy.has_space_role(space_id, 'editor'));

create policy allocations_read on budgetbuddy.budget_allocations
  for select to authenticated using (budgetbuddy.has_space_role(space_id, 'viewer'));
create policy allocations_write on budgetbuddy.budget_allocations
  for all to authenticated
  using (budgetbuddy.has_space_role(space_id, 'editor')) with check (budgetbuddy.has_space_role(space_id, 'editor'));

create policy audit_read on budgetbuddy.audit_logs
  for select to authenticated using (space_id is not null and budgetbuddy.has_space_role(space_id, 'admin'));
-- audit_logs has no write policy: only security-definer functions / service role insert.

grant select, insert, update, delete on all tables in schema budgetbuddy to authenticated;
grant usage, select on all sequences in schema budgetbuddy to authenticated;
revoke delete on budgetbuddy.transactions, budgetbuddy.ledger_entries, budgetbuddy.audit_logs from authenticated;
revoke insert, update on budgetbuddy.audit_logs from authenticated;
revoke update, delete on budgetbuddy.ledger_entries from authenticated;

-- ───────────────────────── RPCs ─────────────────────────
-- Idempotent first-login profile creation; replaces an auth.users trigger.
create function budgetbuddy.ensure_profile() returns budgetbuddy.profiles
language plpgsql security definer set search_path = '' as $$
declare p budgetbuddy.profiles;
begin
  if (select auth.uid()) is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  insert into budgetbuddy.profiles (user_id) values ((select auth.uid()))
    on conflict (user_id) do nothing;
  select * into p from budgetbuddy.profiles where user_id = (select auth.uid());
  return p;
end $$;

-- Creates a space and makes the caller its owner in one atomic step, so a
-- client can never create a space it does not belong to or self-assign roles.
create function budgetbuddy.create_space(p_name text, p_kind budgetbuddy.space_kind, p_currency text)
returns budgetbuddy.financial_spaces
language plpgsql security definer set search_path = '' as $$
declare s budgetbuddy.financial_spaces; uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  insert into budgetbuddy.financial_spaces (name, kind, currency, created_by)
    values (p_name, p_kind, p_currency, uid) returning * into s;
  insert into budgetbuddy.financial_space_members (space_id, user_id, role) values (s.id, uid, 'owner');
  insert into budgetbuddy.audit_logs (space_id, actor, action, entity, entity_id)
    values (s.id, uid, 'create', 'financial_space', s.id);
  return s;
end $$;

revoke all on function budgetbuddy.ensure_profile() from public, anon;
revoke all on function budgetbuddy.create_space(text, budgetbuddy.space_kind, text) from public, anon;
grant execute on function budgetbuddy.ensure_profile() to authenticated;
grant execute on function budgetbuddy.create_space(text, budgetbuddy.space_kind, text) to authenticated;
