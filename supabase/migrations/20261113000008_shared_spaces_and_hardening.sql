-- Migration 8: shared spaces (invitations, member management), ledger-integrity
-- hardening found by the functional audit, refund-aware reversal, and
-- self-service data deletion.
--
-- Audit findings fixed here (each has a regression test in src/db/shared.test.ts):
--   1. members_manage let any admin delete/demote the OWNER and insert arbitrary
--      users as members. Client writes to membership are removed; every change
--      now goes through the functions below, which enforce the role hierarchy.
--   2. An editor could set a posted transaction's status to 'pending' (hiding it
--      from balances) or rewrite created_by / links. Posted rows are now frozen
--      apart from merchant/description/notes.
--   3. An editor could INSERT extra ledger entries onto an existing posted
--      transaction (moving money without a trace). Entries can only be added in
--      the same database transaction that created the header.
--   4. Reversing an expense that still had an active refund left net spending
--      negative. The refund must be reversed first.

-- ───────────── 1. membership: no direct client writes ─────────────
drop policy if exists members_manage on budgetbuddy.financial_space_members;
revoke insert, update, delete on budgetbuddy.financial_space_members from authenticated;

-- ───────────── 2. posted transactions are frozen except metadata ─────────────
create or replace function budgetbuddy.protect_posted_transaction() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and old.status = 'posted' then
    raise exception 'Posted transactions cannot be deleted; reverse them instead';
  end if;
  if tg_op = 'UPDATE' and old.status = 'posted' and (
       new.amount is distinct from old.amount or new.currency is distinct from old.currency
    or new.type is distinct from old.type or new.occurred_at is distinct from old.occurred_at
    or new.space_id is distinct from old.space_id or new.status is distinct from old.status
    or new.refund_of is distinct from old.refund_of or new.reversal_of is distinct from old.reversal_of
    or new.created_by is distinct from old.created_by or new.source is distinct from old.source
    or new.external_id is distinct from old.external_id or new.recorded_at is distinct from old.recorded_at) then
    raise exception 'Posted transaction financial fields are immutable; reverse it instead';
  end if;
  return coalesce(new, old);
end $$;

-- ───────────── 3. entries only in the transaction that created the header ─────────────
create function budgetbuddy.guard_entry_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from budgetbuddy.transactions t where t.id = new.transaction_id and t.recorded_at = now()) then
    raise exception 'Entries can only be added when a transaction is created' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger ledger_entries_guard_insert before insert on budgetbuddy.ledger_entries
  for each row execute function budgetbuddy.guard_entry_insert();

-- ───────────── 4. reversal refuses while a refund is still active ─────────────
create or replace function budgetbuddy.reverse_transaction(p_txn uuid) returns uuid
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
  if exists (
    select 1 from budgetbuddy.transactions r
    where r.refund_of = p_txn and r.status = 'posted'
      and not exists (select 1 from budgetbuddy.transactions v where v.reversal_of = r.id)
  ) then
    raise exception 'Reverse the refund of this expense first' using errcode = '23514';
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

-- ───────────── invitations ─────────────
create table budgetbuddy.space_invites (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references budgetbuddy.financial_spaces (id) on delete cascade,
  code text not null unique,
  role budgetbuddy.space_role not null check (role in ('admin', 'editor', 'viewer')),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_by uuid references auth.users (id),
  used_at timestamptz,
  revoked_at timestamptz
);
create index on budgetbuddy.space_invites (space_id);
alter table budgetbuddy.space_invites enable row level security;
create policy invites_admin_read on budgetbuddy.space_invites
  for select to authenticated using (budgetbuddy.has_space_role(space_id, 'admin'));
grant select on budgetbuddy.space_invites to authenticated;

create function budgetbuddy.create_invite(p_space uuid, p_role budgetbuddy.space_role) returns text
language plpgsql security definer set search_path = '' as $$
declare c text;
begin
  if not budgetbuddy.has_space_role(p_space, 'admin') then
    raise exception 'You do not have permission to invite people to this space' using errcode = '42501';
  end if;
  if p_role = 'owner' then
    raise exception 'A space has one owner; ownership cannot be shared by invitation' using errcode = '23514';
  end if;
  if p_role = 'admin' and not budgetbuddy.has_space_role(p_space, 'owner') then
    raise exception 'Only the owner can invite an admin' using errcode = '42501';
  end if;
  if (select count(*) from budgetbuddy.space_invites
      where space_id = p_space and used_at is null and revoked_at is null and expires_at > now()) >= 20 then
    raise exception 'Too many open invitations; revoke some first' using errcode = '23514';
  end if;
  c := substr(replace(gen_random_uuid()::text, '-', ''), 1, 20);
  insert into budgetbuddy.space_invites (space_id, code, role, created_by, expires_at)
    values (p_space, c, p_role, (select auth.uid()), now() + interval '7 days');
  insert into budgetbuddy.audit_logs (space_id, actor, action, entity, entity_id)
    values (p_space, (select auth.uid()), 'invite', 'space', p_space);
  return c;
end $$;

create function budgetbuddy.revoke_invite(p_invite uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare i budgetbuddy.space_invites;
begin
  select * into i from budgetbuddy.space_invites where id = p_invite;
  if not found or not budgetbuddy.has_space_role(i.space_id, 'admin') then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;
  update budgetbuddy.space_invites set revoked_at = now() where id = p_invite and used_at is null;
end $$;

-- One generic failure message for unknown, used, revoked, expired and already-a-member,
-- so the response never reveals which invitation codes exist.
create function budgetbuddy.accept_invite(p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare i budgetbuddy.space_invites; me uuid := (select auth.uid());
begin
  if me is null then raise exception 'Sign in to accept an invitation' using errcode = '42501'; end if;
  select * into i from budgetbuddy.space_invites where code = p_code for update;
  if not found or i.used_at is not null or i.revoked_at is not null or i.expires_at <= now()
     or exists (select 1 from budgetbuddy.financial_space_members m where m.space_id = i.space_id and m.user_id = me) then
    raise exception 'This invitation is not valid or has expired' using errcode = '22023';
  end if;
  insert into budgetbuddy.financial_space_members (space_id, user_id, role) values (i.space_id, me, i.role);
  update budgetbuddy.space_invites set used_by = me, used_at = now() where id = i.id;
  insert into budgetbuddy.audit_logs (space_id, actor, action, entity, entity_id)
    values (i.space_id, me, 'join', 'space', i.space_id);
  return i.space_id;
end $$;

-- ───────────── member management ─────────────
create function budgetbuddy.list_members(p_space uuid)
returns table (user_id uuid, display_name text, role budgetbuddy.space_role, joined_at timestamptz, is_you boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not budgetbuddy.has_space_role(p_space, 'viewer') then
    raise exception 'Space not found' using errcode = 'P0002';
  end if;
  return query
    select m.user_id, p.display_name, m.role, m.created_at, m.user_id = (select auth.uid())
    from budgetbuddy.financial_space_members m
    left join budgetbuddy.profiles p on p.user_id = m.user_id
    where m.space_id = p_space
    order by budgetbuddy.role_rank(m.role) desc, m.created_at;
end $$;

create function budgetbuddy.set_member_role(p_space uuid, p_user uuid, p_role budgetbuddy.space_role) returns void
language plpgsql security definer set search_path = '' as $$
declare cur budgetbuddy.space_role; me uuid := (select auth.uid());
begin
  if not budgetbuddy.has_space_role(p_space, 'admin') then
    raise exception 'You do not have permission to change roles' using errcode = '42501';
  end if;
  if p_user = me then raise exception 'You cannot change your own role' using errcode = '23514'; end if;
  if p_role = 'owner' then raise exception 'Ownership cannot be assigned' using errcode = '23514'; end if;
  select role into cur from budgetbuddy.financial_space_members where space_id = p_space and user_id = p_user;
  if cur is null then raise exception 'Member not found' using errcode = 'P0002'; end if;
  if cur = 'owner' then raise exception 'The owner''s role cannot be changed' using errcode = '23514'; end if;
  if (cur = 'admin' or p_role = 'admin') and not budgetbuddy.has_space_role(p_space, 'owner') then
    raise exception 'Only the owner can grant or change an admin role' using errcode = '42501';
  end if;
  update budgetbuddy.financial_space_members set role = p_role where space_id = p_space and user_id = p_user;
  insert into budgetbuddy.audit_logs (space_id, actor, action, entity, entity_id)
    values (p_space, me, 'set_role', 'member', p_user);
end $$;

create function budgetbuddy.remove_member(p_space uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare cur budgetbuddy.space_role; me uuid := (select auth.uid());
begin
  select role into cur from budgetbuddy.financial_space_members where space_id = p_space and user_id = p_user;
  if cur is null then raise exception 'Member not found' using errcode = 'P0002'; end if;
  if cur = 'owner' then raise exception 'The owner cannot be removed or leave; delete the space instead' using errcode = '23514'; end if;
  if p_user <> me then
    if not budgetbuddy.has_space_role(p_space, 'admin') then
      raise exception 'You do not have permission to remove members' using errcode = '42501';
    end if;
    if cur = 'admin' and not budgetbuddy.has_space_role(p_space, 'owner') then
      raise exception 'Only the owner can remove an admin' using errcode = '42501';
    end if;
  end if;
  delete from budgetbuddy.financial_space_members where space_id = p_space and user_id = p_user;
  insert into budgetbuddy.audit_logs (space_id, actor, action, entity, entity_id)
    values (p_space, me, case when p_user = me then 'leave' else 'remove_member' end, 'member', p_user);
end $$;

-- ───────────── self-service deletion of Budget Buddy data ─────────────
-- Deletes the caller's Budget Buddy profile and every space they solely own
-- (ledger included), and removes them from spaces owned by others. It does not
-- delete the sign-in account itself, which belongs to the shared auth system.
create function budgetbuddy.delete_my_data() returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); s uuid;
begin
  if me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if exists (
    select 1 from budgetbuddy.financial_space_members o
    where o.user_id = me and o.role = 'owner'
      and exists (select 1 from budgetbuddy.financial_space_members x where x.space_id = o.space_id and x.user_id <> me)
  ) then
    raise exception 'You still own a space that other people use. Remove them or delete that space first.' using errcode = '23514';
  end if;
  -- Posted history is append-only for everyone, so the guard is lifted only for this purge.
  alter table budgetbuddy.transactions disable trigger transactions_protect_posted;
  for s in select space_id from budgetbuddy.financial_space_members where user_id = me and role = 'owner' loop
    delete from budgetbuddy.financial_spaces where id = s;
  end loop;
  alter table budgetbuddy.transactions enable trigger transactions_protect_posted;
  delete from budgetbuddy.financial_space_members where user_id = me;
  delete from budgetbuddy.audit_logs where actor = me;
  delete from budgetbuddy.profiles where user_id = me;
end $$;

revoke all on function budgetbuddy.create_invite(uuid, budgetbuddy.space_role) from public, anon;
revoke all on function budgetbuddy.revoke_invite(uuid) from public, anon;
revoke all on function budgetbuddy.accept_invite(text) from public, anon;
revoke all on function budgetbuddy.list_members(uuid) from public, anon;
revoke all on function budgetbuddy.set_member_role(uuid, uuid, budgetbuddy.space_role) from public, anon;
revoke all on function budgetbuddy.remove_member(uuid, uuid) from public, anon;
revoke all on function budgetbuddy.delete_my_data() from public, anon;
grant execute on function budgetbuddy.create_invite(uuid, budgetbuddy.space_role) to authenticated;
grant execute on function budgetbuddy.revoke_invite(uuid) to authenticated;
grant execute on function budgetbuddy.accept_invite(text) to authenticated;
grant execute on function budgetbuddy.list_members(uuid) to authenticated;
grant execute on function budgetbuddy.set_member_role(uuid, uuid, budgetbuddy.space_role) to authenticated;
grant execute on function budgetbuddy.remove_member(uuid, uuid) to authenticated;
grant execute on function budgetbuddy.delete_my_data() to authenticated;
