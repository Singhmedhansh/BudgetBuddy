-- Migration 10: concurrency guards for the ledger (found by the v1.0 audit).
--
--   1. Refund limit race. post_transaction summed existing refunds and compared the total to the original
--      expense without locking anything, so two refunds submitted at the same moment could each pass the
--      check and together refund more than was spent. The original expense row is now locked (FOR UPDATE)
--      for the duration of the transaction, so concurrent refunds of one expense are checked one by one.
--   2. Double reversal race. reverse_transaction checks "already reversed" before inserting, with no lock,
--      so two simultaneous reversals could both post and turn a net-zero expense into a credit. A unique
--      index now makes the second one fail with a duplicate-key error, whatever the timing.
--
--   3. Goal over-withdrawal. Nothing stopped a withdrawal larger than the amount saved for a goal, so "take out
--      99,999" from a goal holding 2,000 was recorded and left the goal's total at minus 97,999 (the page hid it
--      by showing 0 percent). A trigger now locks the goal and refuses any contribution that would take the saved
--      total below zero, which also serialises two withdrawals submitted together.
--
-- Effects: no data is changed. (Goals that are already negative, all of them disposable test data, are left as they are.) Existing data satisfies the new index (audited before writing this file:
-- no original has more than one reversal). The grants on post_transaction are re-applied unchanged.

create or replace function budgetbuddy.post_transaction(
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
      where o.id = p_refund_of and o.space_id = p_space and o.type = 'expense' and o.status = 'posted'
      for update;   -- serialises concurrent refunds of one expense, so their total cannot pass the original
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

-- A transaction can be reversed at most once, enforced by the database rather than by a prior check.
create unique index transactions_one_reversal on budgetbuddy.transactions (reversal_of) where reversal_of is not null;

revoke all on function budgetbuddy.post_transaction(uuid, budgetbuddy.txn_type, timestamptz, text, bigint, jsonb, text, text, text, budgetbuddy.txn_status, budgetbuddy.txn_source, text, uuid) from public, anon;
grant execute on function budgetbuddy.post_transaction(uuid, budgetbuddy.txn_type, timestamptz, text, bigint, jsonb, text, text, text, budgetbuddy.txn_status, budgetbuddy.txn_source, text, uuid) to authenticated;

-- ───────────── 3. a goal's saved total can never go below zero ─────────────
create function budgetbuddy.guard_goal_contribution() returns trigger
language plpgsql set search_path = '' as $$
declare saved bigint;
begin
  perform 1 from budgetbuddy.savings_goals g where g.id = new.goal_id for update;   -- one contribution at a time per goal
  select coalesce(sum(c.amount), 0) into saved from budgetbuddy.goal_contributions c
    where c.goal_id = new.goal_id and (tg_op = 'INSERT' or c.id <> new.id);
  if saved + new.amount < 0 then
    raise exception 'A withdrawal cannot be more than what is saved for the goal' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger goal_contributions_guard before insert or update of amount on budgetbuddy.goal_contributions
  for each row execute function budgetbuddy.guard_goal_contribution();
