-- Migration 9: profile completion and preferences, private avatars, ownership
-- transfer, a fuller account-data deletion, AI usage limits, plan entitlements
-- and a sample-data marker.
--
-- Everything here is inside the `budgetbuddy` schema, plus one private storage
-- bucket namespaced `budgetbuddy-avatars`. Nothing touches `public` or any other
-- product's objects. Existing rows are unaffected: every new profile column is
-- nullable or has a default, and no data is rewritten.

-- ───────────── 1. profile: personal details and preferences ─────────────
alter table budgetbuddy.profiles
  add column avatar_path text,
  add column phone text,
  add column country text,
  add column date_format text,
  add column number_format text not null default 'en-IN',
  add column profile_completed_at timestamptz,
  add column banner_dismissed_until timestamptz,
  add column dashboard_prefs jsonb not null default '{}'::jsonb,
  add column notification_prefs jsonb not null default '{}'::jsonb;

alter table budgetbuddy.profiles
  add constraint profiles_phone_format check (phone is null or phone ~ '^\+?[0-9][0-9 ()-]{5,18}[0-9]$'),
  add constraint profiles_country_format check (country is null or country ~ '^[A-Z]{2}$'),
  add constraint profiles_date_format_values check (date_format is null or date_format in ('dmy', 'mdy', 'ymd')),
  add constraint profiles_number_format_values check (number_format in ('en-IN', 'en-US', 'de-DE', 'fr-FR')),
  -- An avatar can only point into the person's own folder, so a profile can never reference someone else's file.
  add constraint profiles_avatar_own_folder check (avatar_path is null or avatar_path like user_id::text || '/%'),
  add constraint profiles_prefs_are_objects check (
    jsonb_typeof(dashboard_prefs) = 'object' and jsonb_typeof(notification_prefs) = 'object'
    and length(dashboard_prefs::text) < 2000 and length(notification_prefs::text) < 2000);

-- ───────────── 2. avatars: a private bucket, each person sees only their own folder ─────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('budgetbuddy-avatars', 'budgetbuddy-avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "budgetbuddy avatars read" on storage.objects
  for select to authenticated
  using (bucket_id = 'budgetbuddy-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "budgetbuddy avatars insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'budgetbuddy-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "budgetbuddy avatars update" on storage.objects
  for update to authenticated
  using (bucket_id = 'budgetbuddy-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'budgetbuddy-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "budgetbuddy avatars delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'budgetbuddy-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ───────────── 3. sample data is marked, so it is never mistaken for real money ─────────────
alter table budgetbuddy.financial_spaces add column is_sample boolean not null default false;

-- Sample data can be removed again. Posted ledger rows are protected from deletion for everyone, so the guard is
-- lifted only inside this function, only for a space flagged as sample, only for its sole owner.
create function budgetbuddy.delete_sample_space(p_space uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not budgetbuddy.has_space_role(p_space, 'owner') then
    raise exception 'Only the owner can remove a space' using errcode = '42501';
  end if;
  if not exists (select 1 from budgetbuddy.financial_spaces where id = p_space and is_sample) then
    raise exception 'Only sample data can be removed this way' using errcode = '23514';
  end if;
  if exists (select 1 from budgetbuddy.financial_space_members where space_id = p_space and user_id <> (select auth.uid())) then
    raise exception 'Remove the other members first' using errcode = '23514';
  end if;
  alter table budgetbuddy.transactions disable trigger transactions_protect_posted;
  delete from budgetbuddy.financial_spaces where id = p_space;
  alter table budgetbuddy.transactions enable trigger transactions_protect_posted;
end $$;

-- ───────────── 4. ownership transfer ─────────────
create function budgetbuddy.transfer_ownership(p_space uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if not budgetbuddy.has_space_role(p_space, 'owner') then
    raise exception 'Only the owner can transfer ownership' using errcode = '42501';
  end if;
  if p_user = me then raise exception 'You already own this space' using errcode = '23514'; end if;
  if not exists (select 1 from budgetbuddy.financial_space_members where space_id = p_space and user_id = p_user) then
    raise exception 'That person is not a member of this space' using errcode = 'P0002';
  end if;
  -- One owner at a time: the new owner is promoted and the previous owner stays on as an admin.
  update budgetbuddy.financial_space_members set role = 'admin' where space_id = p_space and user_id = me;
  update budgetbuddy.financial_space_members set role = 'owner' where space_id = p_space and user_id = p_user;
  insert into budgetbuddy.audit_logs (space_id, actor, action, entity, entity_id)
    values (p_space, me, 'transfer_ownership', 'member', p_user);
end $$;

-- ───────────── 5. account-data deletion ─────────────
-- Spaces the caller owns that other people still use. Deletion is refused until each is
-- handed over (transfer_ownership) or emptied, so no one else loses their records.
create function budgetbuddy.deletion_blockers()
returns table (space_id uuid, space_name text, other_members bigint)
language sql stable security definer set search_path = '' as $$
  select s.id, s.name, count(x.user_id)
  from budgetbuddy.financial_spaces s
  join budgetbuddy.financial_space_members o on o.space_id = s.id and o.user_id = (select auth.uid()) and o.role = 'owner'
  join budgetbuddy.financial_space_members x on x.space_id = s.id and x.user_id <> (select auth.uid())
  group by s.id, s.name
$$;

create or replace function budgetbuddy.delete_my_data() returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); s uuid;
begin
  if me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if exists (select 1 from budgetbuddy.deletion_blockers()) then
    raise exception 'You still own a space that other people use. Transfer ownership or remove them first.' using errcode = '23514';
  end if;
  -- Posted history is append-only for everyone; the guard is lifted only for this purge, inside this transaction.
  alter table budgetbuddy.transactions disable trigger transactions_protect_posted;
  for s in select space_id from budgetbuddy.financial_space_members where user_id = me and role = 'owner' loop
    delete from budgetbuddy.financial_spaces where id = s;   -- accounts, ledger, budgets, goals, imports cascade
  end loop;
  alter table budgetbuddy.transactions enable trigger transactions_protect_posted;
  -- Spaces the person only belonged to keep their records; the person is removed and un-named in them.
  delete from budgetbuddy.financial_space_members where user_id = me;
  delete from budgetbuddy.space_invites where created_by = me;
  update budgetbuddy.space_invites set used_by = null where used_by = me;
  update budgetbuddy.audit_logs set actor = null where actor = me;
  delete from budgetbuddy.help_feedback where user_id = me;
  delete from budgetbuddy.support_requests where user_id = me;
  delete from budgetbuddy.ai_usage where user_id = me;
  delete from budgetbuddy.entitlements where user_id = me;
  delete from budgetbuddy.profiles where user_id = me;
end $$;

-- ───────────── 6. AI usage: every call is reserved first, so limits cannot be raced past ─────────────
create table budgetbuddy.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text,
  model text,
  status text not null default 'pending' check (status in ('pending', 'ok', 'error')),
  prompt_tokens integer not null default 0 check (prompt_tokens >= 0),
  completion_tokens integer not null default 0 check (completion_tokens >= 0),
  latency_ms integer,
  created_at timestamptz not null default now()
);
create index on budgetbuddy.ai_usage (user_id, created_at desc);
alter table budgetbuddy.ai_usage enable row level security;
create policy ai_usage_read_own on budgetbuddy.ai_usage for select to authenticated using (user_id = (select auth.uid()));
grant select on budgetbuddy.ai_usage to authenticated;

-- Returns {allowed, id} or {allowed:false, reason}. The advisory lock makes concurrent requests count one by one.
create function budgetbuddy.ai_reserve(p_per_hour integer, p_tokens_per_day integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); n integer; toks bigint; new_id bigint;
begin
  if me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('bb-ai:' || me::text));
  select count(*) into n from budgetbuddy.ai_usage where user_id = me and created_at > now() - interval '1 hour';
  if n >= p_per_hour then return jsonb_build_object('allowed', false, 'reason', 'hourly'); end if;
  select coalesce(sum(prompt_tokens + completion_tokens), 0) into toks
    from budgetbuddy.ai_usage where user_id = me and created_at > now() - interval '1 day';
  if toks >= p_tokens_per_day then return jsonb_build_object('allowed', false, 'reason', 'daily'); end if;
  insert into budgetbuddy.ai_usage (user_id) values (me) returning id into new_id;
  return jsonb_build_object('allowed', true, 'id', new_id);
end $$;

create function budgetbuddy.ai_settle(p_id bigint, p_status text, p_provider text, p_model text, p_prompt integer, p_completion integer, p_latency integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('ok', 'error') then raise exception 'Invalid status' using errcode = '22023'; end if;
  update budgetbuddy.ai_usage
     set status = p_status, provider = p_provider, model = p_model,
         prompt_tokens = greatest(0, p_prompt), completion_tokens = greatest(0, p_completion), latency_ms = p_latency
   where id = p_id and user_id = (select auth.uid()) and status = 'pending';
end $$;

-- ───────────── 7. plan entitlements (written only by the billing webhook with the service role) ─────────────
create table budgetbuddy.entitlements (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  status text not null default 'active' check (status in ('active', 'trialing', 'past_due', 'canceled')),
  provider text check (provider in ('razorpay', 'paypal', 'manual')),
  provider_ref text,
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);
alter table budgetbuddy.entitlements enable row level security;
create policy entitlements_read_own on budgetbuddy.entitlements for select to authenticated using (user_id = (select auth.uid()));
grant select on budgetbuddy.entitlements to authenticated;

-- Idempotency for webhooks: an event id is processed once.
create table budgetbuddy.payment_events (
  provider text not null check (provider in ('razorpay', 'paypal')),
  event_id text not null,
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);
alter table budgetbuddy.payment_events enable row level security;
revoke all on budgetbuddy.payment_events from anon, authenticated;

-- ───────────── grants ─────────────
revoke all on function budgetbuddy.transfer_ownership(uuid, uuid) from public, anon;
revoke all on function budgetbuddy.delete_sample_space(uuid) from public, anon;
grant execute on function budgetbuddy.delete_sample_space(uuid) to authenticated;
revoke all on function budgetbuddy.deletion_blockers() from public, anon;
revoke all on function budgetbuddy.ai_reserve(integer, integer) from public, anon;
revoke all on function budgetbuddy.ai_settle(bigint, text, text, text, integer, integer, integer) from public, anon;
grant execute on function budgetbuddy.transfer_ownership(uuid, uuid) to authenticated;
grant execute on function budgetbuddy.deletion_blockers() to authenticated;
grant execute on function budgetbuddy.ai_reserve(integer, integer) to authenticated;
grant execute on function budgetbuddy.ai_settle(bigint, text, text, text, integer, integer, integer) to authenticated;
