-- Savings goals, recurring items (bills, subscriptions, expected income) and debt terms.

-- ───────────── savings goals ─────────────
create table budgetbuddy.savings_goals (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references budgetbuddy.financial_spaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  target_amount bigint not null check (target_amount > 0),
  currency text not null,
  deadline date,
  priority smallint not null default 2 check (priority between 1 and 3),
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'archived')),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);
create index on budgetbuddy.savings_goals (space_id);

-- Tracked amounts toward a goal. These are NOT ledger postings: they never move
-- money or change a balance, so they cannot be counted as expenses.
create table budgetbuddy.goal_contributions (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references budgetbuddy.savings_goals (id) on delete cascade,
  space_id uuid not null references budgetbuddy.financial_spaces (id) on delete cascade,
  amount bigint not null check (amount <> 0),          -- negative = withdrawal
  contributed_on date not null,
  note text check (note is null or char_length(note) <= 200),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);
create index on budgetbuddy.goal_contributions (goal_id, contributed_on desc);

-- ───────────── recurring items ─────────────
create table budgetbuddy.recurring_items (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references budgetbuddy.financial_spaces (id) on delete cascade,
  kind text not null check (kind in ('bill', 'subscription', 'income')),
  name text not null check (char_length(name) between 1 and 80),
  amount bigint not null check (amount > 0),
  currency text not null,
  frequency text not null check (frequency in ('once', 'weekly', 'monthly', 'quarterly', 'yearly')),
  first_due date not null,
  ends_on date check (ends_on is null or ends_on >= first_due),
  account_id uuid references budgetbuddy.accounts (id),        -- paid from / received into
  category_id uuid references budgetbuddy.categories (id),     -- expense category or income source
  remind_days smallint not null default 3 check (remind_days between 0 and 60),
  auto_renews boolean not null default true,
  status text not null default 'active' check (status in ('active', 'paused', 'cancelled')),
  notes text check (notes is null or char_length(notes) <= 500),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);
create index on budgetbuddy.recurring_items (space_id, kind);

create table budgetbuddy.recurring_payments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references budgetbuddy.recurring_items (id) on delete cascade,
  space_id uuid not null references budgetbuddy.financial_spaces (id) on delete cascade,
  due_date date not null,
  paid_on date not null,
  transaction_id uuid not null references budgetbuddy.transactions (id),
  created_at timestamptz not null default now(),
  unique (item_id, due_date)          -- a due date can be settled only once
);

-- ───────────── debt terms (extra facts about a liability account) ─────────────
create table budgetbuddy.debt_terms (
  account_id uuid primary key references budgetbuddy.accounts (id) on delete cascade,
  space_id uuid not null references budgetbuddy.financial_spaces (id) on delete cascade,
  interest_rate_bps integer not null check (interest_rate_bps between 0 and 100000),
  min_payment bigint not null default 0 check (min_payment >= 0),
  due_day smallint check (due_day between 1 and 31),
  original_principal bigint check (original_principal is null or original_principal >= 0),
  updated_at timestamptz not null default now()
);

create function budgetbuddy.check_debt_terms() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from budgetbuddy.accounts a
    where a.id = new.account_id and a.space_id = new.space_id and a.type in ('credit_card', 'other_liability')
  ) then
    raise exception 'Debt terms apply only to a credit card or liability account in the same space' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger debt_terms_valid before insert or update on budgetbuddy.debt_terms
  for each row execute function budgetbuddy.check_debt_terms();

-- Recurring item account/category must belong to the item's space.
create function budgetbuddy.check_recurring_item() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.account_id is not null and not exists (select 1 from budgetbuddy.accounts a where a.id = new.account_id and a.space_id = new.space_id) then
    raise exception 'Account does not belong to this space' using errcode = '23514';
  end if;
  if new.category_id is not null and not exists (
    select 1 from budgetbuddy.categories c where c.id = new.category_id and c.space_id = new.space_id
      and c.kind::text = case when new.kind = 'income' then 'income' else 'expense' end
  ) then
    raise exception 'Category must be a matching category in this space' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger recurring_items_valid before insert or update on budgetbuddy.recurring_items
  for each row execute function budgetbuddy.check_recurring_item();

-- ───────────── RLS ─────────────
alter table budgetbuddy.savings_goals enable row level security;
alter table budgetbuddy.goal_contributions enable row level security;
alter table budgetbuddy.recurring_items enable row level security;
alter table budgetbuddy.recurring_payments enable row level security;
alter table budgetbuddy.debt_terms enable row level security;

create policy goals_read on budgetbuddy.savings_goals for select to authenticated using (budgetbuddy.has_space_role(space_id, 'viewer'));
create policy goals_write on budgetbuddy.savings_goals for all to authenticated
  using (budgetbuddy.has_space_role(space_id, 'editor')) with check (budgetbuddy.has_space_role(space_id, 'editor'));

create policy contrib_read on budgetbuddy.goal_contributions for select to authenticated using (budgetbuddy.has_space_role(space_id, 'viewer'));
create policy contrib_write on budgetbuddy.goal_contributions for all to authenticated
  using (budgetbuddy.has_space_role(space_id, 'editor'))
  with check (budgetbuddy.has_space_role(space_id, 'editor')
    and exists (select 1 from budgetbuddy.savings_goals g where g.id = goal_id and g.space_id = goal_contributions.space_id));

create policy recurring_read on budgetbuddy.recurring_items for select to authenticated using (budgetbuddy.has_space_role(space_id, 'viewer'));
create policy recurring_write on budgetbuddy.recurring_items for all to authenticated
  using (budgetbuddy.has_space_role(space_id, 'editor')) with check (budgetbuddy.has_space_role(space_id, 'editor'));

create policy payments_read on budgetbuddy.recurring_payments for select to authenticated using (budgetbuddy.has_space_role(space_id, 'viewer'));
create policy payments_insert on budgetbuddy.recurring_payments for insert to authenticated
  with check (budgetbuddy.has_space_role(space_id, 'editor'));

create policy debt_read on budgetbuddy.debt_terms for select to authenticated using (budgetbuddy.has_space_role(space_id, 'viewer'));
create policy debt_write on budgetbuddy.debt_terms for all to authenticated
  using (budgetbuddy.has_space_role(space_id, 'editor')) with check (budgetbuddy.has_space_role(space_id, 'editor'));

grant select, insert, update, delete on budgetbuddy.savings_goals, budgetbuddy.goal_contributions,
  budgetbuddy.recurring_items, budgetbuddy.debt_terms to authenticated;
grant select, insert on budgetbuddy.recurring_payments to authenticated;

-- ───────────── settle a recurring item ─────────────
-- Posts the real ledger transaction (expense for a bill/subscription, income for
-- expected income) and records which due date it settled, atomically. Expected
-- income therefore changes no balance until it is marked received. SECURITY
-- INVOKER: RLS applies, so viewers and non-members are denied.
create function budgetbuddy.settle_recurring_item(p_item uuid, p_due date, p_paid_on date, p_occurred_at timestamptz)
returns uuid
language plpgsql security invoker set search_path = '' as $$
declare i budgetbuddy.recurring_items; t uuid; entries jsonb;
begin
  select * into i from budgetbuddy.recurring_items where id = p_item;
  if not found then raise exception 'Item not found' using errcode = 'P0002'; end if;
  if i.status <> 'active' then raise exception 'Only an active item can be settled' using errcode = '23514'; end if;
  if i.account_id is null or i.category_id is null then
    raise exception 'Choose an account and category for this item first' using errcode = '23514';
  end if;
  if p_due < i.first_due or (i.ends_on is not null and p_due > i.ends_on) then
    raise exception 'That due date is outside this item''s schedule' using errcode = '23514';
  end if;
  if exists (select 1 from budgetbuddy.recurring_payments where item_id = p_item and due_date = p_due) then
    raise exception 'already_settled' using errcode = '23505';
  end if;

  if i.kind = 'income' then
    entries := jsonb_build_array(
      jsonb_build_object('account_id', i.account_id, 'amount', i.amount),
      jsonb_build_object('category_id', i.category_id, 'amount', -i.amount));
  else
    entries := jsonb_build_array(
      jsonb_build_object('account_id', i.account_id, 'amount', -i.amount),
      jsonb_build_object('category_id', i.category_id, 'amount', i.amount));
  end if;

  t := budgetbuddy.post_transaction(
    i.space_id, case when i.kind = 'income' then 'income'::budgetbuddy.txn_type else 'expense'::budgetbuddy.txn_type end,
    p_occurred_at, i.currency, i.amount, entries, i.name, null, null);
  insert into budgetbuddy.recurring_payments (item_id, space_id, due_date, paid_on, transaction_id)
    values (p_item, i.space_id, p_due, p_paid_on, t);
  return t;
end $$;

revoke all on function budgetbuddy.settle_recurring_item(uuid, date, date, timestamptz) from public, anon;
grant execute on function budgetbuddy.settle_recurring_item(uuid, date, date, timestamptz) to authenticated;
