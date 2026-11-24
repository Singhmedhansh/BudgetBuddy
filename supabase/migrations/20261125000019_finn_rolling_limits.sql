-- Migration 19: Finn allowances counted over a rolling window, as other assistants do, instead of only per calendar day.
--
--   ai_usage.kind          what a use was for: 'chat' (a question to a model), 'scan' (reading a photo of a bill) or
--                          'doc' (an attached file). Existing rows are chats.
--   ai_reserve_window      reserves one use if every limit allows it: a burst guard per minute, a rolling window (for
--                          example 20 in 5 hours), a daily ceiling, a monthly token backstop, and an optional daily cap
--                          for one kind. When a limit is reached it says which, and when the next use frees up
--                          (retry_at), so the app can say "next message at 3:40 pm" instead of "come back tomorrow".
--   ai_quota_window        what has been used in the window, today and this month, and when the window frees up.
--   finn_prefs.auto_save_logs   the person's opt-in to have quick records ("400 on food") saved at once, with an Undo,
--                          instead of a card to confirm. Off by default. A person can change only their own.
--
-- Failed tries (status 'error') never count, as before. Quick records Finn makes in code never reserve anything.
-- ai_reserve_plan and ai_quota stay, so an app version from before this migration keeps working.
--
-- Rollback: supabase/rollback/20261125000019_finn_rolling_limits_down.sql

alter table budgetbuddy.ai_usage
  add column kind text not null default 'chat' check (kind in ('chat', 'scan', 'doc'));
create index ai_usage_user_created on budgetbuddy.ai_usage (user_id, created_at desc);

create function budgetbuddy.ai_reserve_window(
  p_per_minute integer,
  p_window_hours integer,
  p_window_max integer,
  p_day_max integer,
  p_day_start timestamptz,
  p_tokens_per_month integer,
  p_month_start timestamptz,
  p_kind text default 'chat',
  p_kind_day_max integer default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  win_start timestamptz := now() - make_interval(hours => p_window_hours);
  n integer;
  oldest timestamptz;
  toks bigint;
  new_id bigint;
begin
  if me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_kind not in ('chat', 'scan', 'doc') then raise exception 'Unknown kind' using errcode = '22023'; end if;
  if p_window_hours < 1 or p_window_hours > 24 or p_window_max < 1 or p_day_max < 1 or p_per_minute < 1 then
    raise exception 'Bad limits' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('bb-ai:' || me::text));

  -- Burst guard: every try counts here, failed or not, so a loop cannot hammer the providers.
  select count(*) into n from budgetbuddy.ai_usage where user_id = me and created_at > now() - interval '1 minute';
  if n >= p_per_minute then
    return jsonb_build_object('allowed', false, 'reason', 'minute', 'retry_at', now() + interval '1 minute');
  end if;

  -- Rolling window: the next use frees up when the oldest counted use in the window is older than the window.
  select count(*) into n from budgetbuddy.ai_usage
    where user_id = me and created_at > win_start and status <> 'error';
  if n >= p_window_max then
    select created_at into oldest from budgetbuddy.ai_usage
      where user_id = me and created_at > win_start and status <> 'error'
      order by created_at asc offset (n - p_window_max) limit 1;
    return jsonb_build_object('allowed', false, 'reason', 'plan_window',
      'retry_at', oldest + make_interval(hours => p_window_hours));
  end if;

  select count(*) into n from budgetbuddy.ai_usage
    where user_id = me and created_at >= p_day_start and status <> 'error';
  if n >= p_day_max then
    return jsonb_build_object('allowed', false, 'reason', 'plan_day', 'retry_at', p_day_start + interval '1 day');
  end if;

  if p_kind_day_max is not null then
    select count(*) into n from budgetbuddy.ai_usage
      where user_id = me and created_at >= p_day_start and status <> 'error' and kind = p_kind;
    if n >= p_kind_day_max then
      return jsonb_build_object('allowed', false, 'reason', 'kind_day', 'retry_at', p_day_start + interval '1 day');
    end if;
  end if;

  select coalesce(sum(prompt_tokens + completion_tokens), 0) into toks from budgetbuddy.ai_usage
    where user_id = me and created_at >= p_month_start;
  if toks >= p_tokens_per_month then
    return jsonb_build_object('allowed', false, 'reason', 'plan_month');
  end if;

  insert into budgetbuddy.ai_usage (user_id, kind) values (me, p_kind) returning id into new_id;
  return jsonb_build_object('allowed', true, 'id', new_id);
end $$;

create function budgetbuddy.ai_quota_window(
  p_window_hours integer,
  p_window_max integer,
  p_day_start timestamptz,
  p_month_start timestamptz
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  win_start timestamptz := now() - make_interval(hours => least(greatest(p_window_hours, 1), 24));
  n integer;
  oldest timestamptz;
begin
  select count(*) into n from budgetbuddy.ai_usage
    where user_id = me and created_at > win_start and status <> 'error';
  if n >= greatest(p_window_max, 1) then
    select created_at into oldest from budgetbuddy.ai_usage
      where user_id = me and created_at > win_start and status <> 'error'
      order by created_at asc offset (n - greatest(p_window_max, 1)) limit 1;
  else
    select min(created_at) into oldest from budgetbuddy.ai_usage
      where user_id = me and created_at > win_start and status <> 'error';
  end if;
  return jsonb_build_object(
    'window_used', n,
    'window_frees_at', case when oldest is null then null
      else oldest + make_interval(hours => least(greatest(p_window_hours, 1), 24)) end,
    'questions_today', (select count(*) from budgetbuddy.ai_usage
      where user_id = me and created_at >= p_day_start and status <> 'error'),
    'scans_today', (select count(*) from budgetbuddy.ai_usage
      where user_id = me and created_at >= p_day_start and status <> 'error' and kind = 'scan'),
    'tokens_month', (select coalesce(sum(prompt_tokens + completion_tokens), 0) from budgetbuddy.ai_usage
      where user_id = me and created_at >= p_month_start)
  );
end $$;

revoke all on function budgetbuddy.ai_reserve_window(integer, integer, integer, integer, timestamptz, integer, timestamptz, text, integer) from public, anon;
revoke all on function budgetbuddy.ai_quota_window(integer, integer, timestamptz, timestamptz) from public, anon;
grant execute on function budgetbuddy.ai_reserve_window(integer, integer, integer, integer, timestamptz, integer, timestamptz, text, integer) to authenticated;
grant execute on function budgetbuddy.ai_quota_window(integer, integer, timestamptz, timestamptz) to authenticated;

alter table budgetbuddy.finn_prefs add column auto_save_logs boolean not null default false;
grant insert (auto_save_logs) on budgetbuddy.finn_prefs to authenticated;
grant update (auto_save_logs) on budgetbuddy.finn_prefs to authenticated;
