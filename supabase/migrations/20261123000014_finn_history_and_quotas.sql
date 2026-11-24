-- Migration 14: Finn chat history and plan-based allowances.
--
--   finn_conversations   one row per chat: title, pinned, timestamps. A person reads and changes only their own.
--   finn_messages        the messages of a chat (words, the label of where the answer came from, and the charts shown).
--   ai_reserve_plan      like ai_reserve, but enforces the PLAN's allowance: questions per local day and tokens per month,
--                        as well as the hourly guard. The application passes the start of the person's day and month.
--   ai_quota             what has been used today and this month, for the usage meter.
--
-- Chats are private to the person (row-level security) and are deleted with the account. Nothing existing is changed.
--
-- Rollback: supabase/rollback/20261123000014_finn_history_and_quotas_down.sql

create table budgetbuddy.finn_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  space_id uuid references budgetbuddy.financial_spaces (id) on delete set null,
  title text not null default 'New chat' check (char_length(title) between 1 and 120),
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on budgetbuddy.finn_conversations (user_id, pinned desc, updated_at desc);

create table budgetbuddy.finn_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references budgetbuddy.finn_conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 8000),
  source text check (source is null or source in ('model', 'figures', 'general')),
  visuals jsonb check (visuals is null or pg_column_size(visuals) <= 60000),
  created_at timestamptz not null default now()
);
create index on budgetbuddy.finn_messages (conversation_id, id);

alter table budgetbuddy.finn_conversations enable row level security;
alter table budgetbuddy.finn_messages enable row level security;

create policy finn_conversations_own on budgetbuddy.finn_conversations for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- A message can be written only into the person's own conversation.
create policy finn_messages_own on budgetbuddy.finn_messages for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from budgetbuddy.finn_conversations c where c.id = conversation_id and c.user_id = (select auth.uid()))
  );

grant select, insert, update, delete on budgetbuddy.finn_conversations to authenticated;
grant select, insert, delete on budgetbuddy.finn_messages to authenticated;
revoke all on budgetbuddy.finn_conversations, budgetbuddy.finn_messages from anon;

-- ───────────── plan allowances ─────────────
-- A question counts unless it failed (a failed try costs the person nothing). Tokens count in full.
create function budgetbuddy.ai_reserve_plan(
  p_per_hour integer, p_questions_per_day integer, p_day_start timestamptz, p_tokens_per_month integer, p_month_start timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); n integer; q integer; toks bigint; new_id bigint;
begin
  if me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('bb-ai:' || me::text));
  select count(*) into n from budgetbuddy.ai_usage where user_id = me and created_at > now() - interval '1 hour';
  if n >= p_per_hour then return jsonb_build_object('allowed', false, 'reason', 'hourly'); end if;
  select count(*) into q from budgetbuddy.ai_usage where user_id = me and created_at >= p_day_start and status <> 'error';
  if q >= p_questions_per_day then return jsonb_build_object('allowed', false, 'reason', 'plan_day'); end if;
  select coalesce(sum(prompt_tokens + completion_tokens), 0) into toks from budgetbuddy.ai_usage where user_id = me and created_at >= p_month_start;
  if toks >= p_tokens_per_month then return jsonb_build_object('allowed', false, 'reason', 'plan_month'); end if;
  insert into budgetbuddy.ai_usage (user_id) values (me) returning id into new_id;
  return jsonb_build_object('allowed', true, 'id', new_id);
end $$;

create function budgetbuddy.ai_quota(p_day_start timestamptz, p_month_start timestamptz) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'questions_today', (select count(*) from budgetbuddy.ai_usage where user_id = (select auth.uid()) and created_at >= p_day_start and status <> 'error'),
    'tokens_month', (select coalesce(sum(prompt_tokens + completion_tokens), 0) from budgetbuddy.ai_usage where user_id = (select auth.uid()) and created_at >= p_month_start)
  )
$$;

revoke all on function budgetbuddy.ai_reserve_plan(integer, integer, timestamptz, integer, timestamptz) from public, anon;
revoke all on function budgetbuddy.ai_quota(timestamptz, timestamptz) from public, anon;
grant execute on function budgetbuddy.ai_reserve_plan(integer, integer, timestamptz, integer, timestamptz) to authenticated;
grant execute on function budgetbuddy.ai_quota(timestamptz, timestamptz) to authenticated;
