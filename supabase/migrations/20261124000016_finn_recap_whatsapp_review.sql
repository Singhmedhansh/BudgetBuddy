-- Migration 16: Finn weekly recap, WhatsApp and the thumbs-down review queue.
--
--   finn_prefs         one row per person: whether they want the weekly recap email, and when the last one went out.
--                      A person reads their own row and changes only the opt-in; the send time is written by the server.
--   whatsapp_links     a person's WhatsApp number, the short code they send to prove it is theirs, and (briefly) an
--                      action Finn proposed and is waiting for a YES on. A person can read their own link and remove
--                      it; starting a link goes through finn_whatsapp_start, and the server confirms it.
--   whatsapp_seen      message ids already handled, so a message that WhatsApp delivers twice is acted on once.
--                      Server only: no policy, no grant.
--   finn_messages.reviewed_at   set by the server when a thumbs-down answer has been looked at. A person cannot change it.
--
-- Nothing existing is changed apart from the new column and index on finn_messages.
--
-- Rollback: supabase/rollback/20261124000016_finn_recap_whatsapp_review_down.sql

create table budgetbuddy.finn_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  weekly_recap boolean not null default false,
  recap_sent_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table budgetbuddy.finn_prefs enable row level security;
create policy finn_prefs_own on budgetbuddy.finn_prefs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select on budgetbuddy.finn_prefs to authenticated;
grant insert (user_id, weekly_recap) on budgetbuddy.finn_prefs to authenticated;
grant update (weekly_recap, updated_at) on budgetbuddy.finn_prefs to authenticated;
revoke all on budgetbuddy.finn_prefs from anon;

create table budgetbuddy.whatsapp_links (
  user_id uuid primary key references auth.users (id) on delete cascade,
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  code text check (code is null or code ~ '^[0-9]{6}$'),
  code_expires_at timestamptz,
  verified_at timestamptz,
  pending jsonb check (pending is null or pg_column_size(pending) <= 4000),
  created_at timestamptz not null default now()
);
-- A verified number belongs to one person.
create unique index whatsapp_links_verified_phone on budgetbuddy.whatsapp_links (phone) where verified_at is not null;
create index on budgetbuddy.whatsapp_links (phone);
alter table budgetbuddy.whatsapp_links enable row level security;
create policy whatsapp_links_read on budgetbuddy.whatsapp_links for select to authenticated using (user_id = (select auth.uid()));
create policy whatsapp_links_delete on budgetbuddy.whatsapp_links for delete to authenticated using (user_id = (select auth.uid()));
grant select (user_id, phone, code_expires_at, verified_at, created_at) on budgetbuddy.whatsapp_links to authenticated;
grant delete on budgetbuddy.whatsapp_links to authenticated;
revoke all on budgetbuddy.whatsapp_links from anon;

create table budgetbuddy.whatsapp_seen (
  msg_id text primary key,
  seen_at timestamptz not null default now()
);
alter table budgetbuddy.whatsapp_seen enable row level security;
revoke all on budgetbuddy.whatsapp_seen from anon, authenticated;

-- Starts (or restarts) linking a number: returns the code to send to the FinTrack WhatsApp number from that phone.
create function budgetbuddy.finn_whatsapp_start(p_phone text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c text; exp timestamptz := now() + interval '15 minutes';
begin
  if me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Enter the number with its country code, like +919876543210' using errcode = '22023';
  end if;
  if exists (select 1 from budgetbuddy.whatsapp_links where phone = p_phone and verified_at is not null and user_id <> me) then
    raise exception 'That number is already linked to another account' using errcode = '23505';
  end if;
  c := lpad((floor(random() * 1000000))::int::text, 6, '0');
  insert into budgetbuddy.whatsapp_links (user_id, phone, code, code_expires_at, verified_at, pending)
  values (me, p_phone, c, exp, null, null)
  on conflict (user_id) do update
    set phone = excluded.phone, code = excluded.code, code_expires_at = excluded.code_expires_at,
        verified_at = null, pending = null;
  return jsonb_build_object('code', c, 'expires_at', exp);
end $$;
revoke all on function budgetbuddy.finn_whatsapp_start(text) from public, anon;
grant execute on function budgetbuddy.finn_whatsapp_start(text) to authenticated;

alter table budgetbuddy.finn_messages add column reviewed_at timestamptz;
create index on budgetbuddy.finn_messages (created_at desc) where feedback = 'down' and reviewed_at is null;
