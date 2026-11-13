-- 1. Equity counterpart accounts for opening balances and manual adjustments.
alter table budgetbuddy.categories drop constraint categories_kind_check;
alter table budgetbuddy.categories
  add constraint categories_kind_check check (kind in ('expense', 'income', 'equity'));

-- 2. An entry may only reference an account/category that belongs to the same
--    space as the entry. Without this, an editor of space A who learned the UUID
--    of an account in space B could post entries against it.
create function budgetbuddy.check_entry_space() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.account_id is not null and not exists (
    select 1 from budgetbuddy.accounts a where a.id = new.account_id and a.space_id = new.space_id
  ) then
    raise exception 'Account does not belong to this space' using errcode = '23514';
  end if;
  if new.category_id is not null and not exists (
    select 1 from budgetbuddy.categories c where c.id = new.category_id and c.space_id = new.space_id
  ) then
    raise exception 'Category does not belong to this space' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger ledger_entries_same_space
  before insert on budgetbuddy.ledger_entries
  for each row execute function budgetbuddy.check_entry_space();

-- 3. Seed the equity categories when a space is created.
create or replace function budgetbuddy.create_space(p_name text, p_kind budgetbuddy.space_kind, p_currency text)
returns budgetbuddy.financial_spaces
language plpgsql security definer set search_path = '' as $$
declare s budgetbuddy.financial_spaces; uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  insert into budgetbuddy.financial_spaces (name, kind, currency, created_by)
    values (p_name, p_kind, p_currency, uid) returning * into s;
  insert into budgetbuddy.financial_space_members (space_id, user_id, role) values (s.id, uid, 'owner');
  insert into budgetbuddy.categories (space_id, name, kind) values
    (s.id, 'Opening balance', 'equity'), (s.id, 'Balance adjustment', 'equity');
  insert into budgetbuddy.audit_logs (space_id, actor, action, entity, entity_id)
    values (s.id, uid, 'create', 'financial_space', s.id);
  return s;
end $$;

-- 4. Post a transaction and all its ledger entries atomically. SECURITY INVOKER:
--    Row Level Security applies to the caller, so a viewer or non-member is denied.
--    The deferred trigger rejects the whole call if the entries do not sum to zero.
create function budgetbuddy.post_transaction(
  p_space uuid,
  p_type budgetbuddy.txn_type,
  p_occurred_at timestamptz,
  p_currency text,
  p_amount bigint,
  p_entries jsonb,
  p_merchant text default null,
  p_description text default null,
  p_notes text default null,
  p_status budgetbuddy.txn_status default 'posted',
  p_source budgetbuddy.txn_source default 'manual',
  p_external_id text default null,
  p_refund_of uuid default null
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare t uuid; e jsonb; orig bigint; refunded bigint;
begin
  if p_refund_of is not null then
    select o.amount into orig from budgetbuddy.transactions o
      where o.id = p_refund_of and o.space_id = p_space and o.type = 'expense' and o.status = 'posted';
    if orig is null then
      raise exception 'A refund must reference a posted expense in the same space' using errcode = '23514';
    end if;
    select coalesce(sum(r.amount), 0) into refunded from budgetbuddy.transactions r
      where r.refund_of = p_refund_of and r.status = 'posted'
        and not exists (select 1 from budgetbuddy.transactions v where v.reversal_of = r.id);
    if refunded + p_amount > orig then
      raise exception 'Refund exceeds the refundable amount of the original expense' using errcode = '23514';
    end if;
  end if;

  insert into budgetbuddy.transactions
    (space_id, type, status, occurred_at, currency, amount, merchant, description, notes, source, external_id, refund_of, created_by)
  values
    (p_space, p_type, p_status, p_occurred_at, p_currency, p_amount, p_merchant, p_description, p_notes, p_source, p_external_id, p_refund_of, (select auth.uid()))
  returning id into t;

  for e in select * from jsonb_array_elements(p_entries) loop
    insert into budgetbuddy.ledger_entries (transaction_id, space_id, account_id, category_id, amount)
    values (t, p_space, nullif(e->>'account_id', '')::uuid, nullif(e->>'category_id', '')::uuid, (e->>'amount')::bigint);
  end loop;
  return t;
end $$;

-- 5. Reverse a posted transaction by posting an offsetting one. The original is
--    never edited or deleted; it stays posted and the reversal nets it to zero.
--    SECURITY DEFINER so the audit entry is written by the database, not the
--    caller (clients cannot write audit_logs). Authorization is explicit: the
--    caller must be an editor of the transaction's space, and a missing
--    transaction and a forbidden one produce the same error.
create function budgetbuddy.reverse_transaction(p_txn uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare o budgetbuddy.transactions; t uuid;
begin
  select * into o from budgetbuddy.transactions where id = p_txn;
  if not found or not budgetbuddy.has_space_role(o.space_id, 'editor') then
    raise exception 'Transaction not found' using errcode = 'P0002';
  end if;
  if o.status <> 'posted' or o.reversal_of is not null then
    raise exception 'Only an original posted transaction can be reversed' using errcode = '23514';
  end if;
  if exists (select 1 from budgetbuddy.transactions where reversal_of = p_txn) then
    raise exception 'This transaction was already reversed' using errcode = '23514';
  end if;
  insert into budgetbuddy.transactions
    (space_id, type, status, occurred_at, currency, amount, description, source, reversal_of, created_by)
  values (o.space_id, o.type, 'posted', now(), o.currency, o.amount, 'Reversal', 'manual', o.id, (select auth.uid()))
  returning id into t;
  insert into budgetbuddy.ledger_entries (transaction_id, space_id, account_id, category_id, amount)
    select t, space_id, account_id, category_id, -amount from budgetbuddy.ledger_entries where transaction_id = p_txn;
  insert into budgetbuddy.audit_logs (space_id, actor, action, entity, entity_id)
    values (o.space_id, (select auth.uid()), 'reverse', 'transaction', o.id);
  return t;
end $$;

-- 6. Balances derived from posted ledger entries (debit-positive). The view runs
--    with the caller's privileges, so RLS decides which accounts are visible.
create view budgetbuddy.account_balances with (security_invoker = true) as
  select e.account_id, e.space_id, coalesce(sum(e.amount), 0)::bigint as ledger_balance
  from budgetbuddy.ledger_entries e
  join budgetbuddy.transactions t on t.id = e.transaction_id and t.status = 'posted'
  where e.account_id is not null
  group by e.account_id, e.space_id;

revoke all on function budgetbuddy.post_transaction(uuid, budgetbuddy.txn_type, timestamptz, text, bigint, jsonb, text, text, text, budgetbuddy.txn_status, budgetbuddy.txn_source, text, uuid) from public, anon;
revoke all on function budgetbuddy.reverse_transaction(uuid) from public, anon;
grant execute on function budgetbuddy.post_transaction(uuid, budgetbuddy.txn_type, timestamptz, text, bigint, jsonb, text, text, text, budgetbuddy.txn_status, budgetbuddy.txn_source, text, uuid) to authenticated;
grant execute on function budgetbuddy.reverse_transaction(uuid) to authenticated;
grant select on budgetbuddy.account_balances to authenticated;
