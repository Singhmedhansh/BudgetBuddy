-- Migration 11: AI usage monitoring and a platform-admin gate.
--
--   1. ai_usage gains an error category, the number of upstream attempts, how many failed before the answer
--      (fallbacks) and how many of those were rate limits. These are counts and category names only: no prompt,
--      no answer, no key, no provider message is stored.
--   2. ai_settle takes the new details as optional arguments. The old 7-argument version is replaced by one with
--      defaults, so callers that have not been updated keep working.
--   3. platform_admins lists the people allowed to see cross-user operational data. It starts EMPTY: nobody is an
--      admin until the owner inserts a row by hand (see docs/ai-and-payments.md). It is never writable from the app.
--   4. ai_usage_summary(days) returns aggregate figures for admins only. Aggregates, never individual rows.
--
-- Effects: additive columns with defaults, one function replaced, no data changed or deleted.

alter table budgetbuddy.ai_usage
  add column error_kind text,
  add column attempts smallint not null default 0 check (attempts >= 0),
  add column fallbacks smallint not null default 0 check (fallbacks >= 0),
  add column rate_limited smallint not null default 0 check (rate_limited >= 0);
create index on budgetbuddy.ai_usage (created_at desc);

drop function budgetbuddy.ai_settle(bigint, text, text, text, integer, integer, integer);
create function budgetbuddy.ai_settle(
  p_id bigint, p_status text, p_provider text, p_model text, p_prompt integer, p_completion integer, p_latency integer,
  p_error_kind text default null, p_attempts integer default 0, p_fallbacks integer default 0, p_rate_limited integer default 0
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('ok', 'error') then raise exception 'Invalid status' using errcode = '22023'; end if;
  update budgetbuddy.ai_usage
     set status = p_status, provider = p_provider, model = p_model,
         prompt_tokens = greatest(0, p_prompt), completion_tokens = greatest(0, p_completion), latency_ms = p_latency,
         error_kind = left(p_error_kind, 40),
         attempts = least(greatest(0, p_attempts), 100), fallbacks = least(greatest(0, p_fallbacks), 100),
         rate_limited = least(greatest(0, p_rate_limited), 100)
   where id = p_id and user_id = (select auth.uid()) and status = 'pending';
end $$;
revoke all on function budgetbuddy.ai_settle(bigint, text, text, text, integer, integer, integer, text, integer, integer, integer) from public, anon;
grant execute on function budgetbuddy.ai_settle(bigint, text, text, text, integer, integer, integer, text, integer, integer, integer) to authenticated;

create table budgetbuddy.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table budgetbuddy.platform_admins enable row level security;
revoke all on budgetbuddy.platform_admins from anon, authenticated;

create function budgetbuddy.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from budgetbuddy.platform_admins where user_id = (select auth.uid()))
$$;
revoke all on function budgetbuddy.is_platform_admin() from public, anon;
grant execute on function budgetbuddy.is_platform_admin() to authenticated;

create function budgetbuddy.ai_usage_summary(p_days integer default 7) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare d integer := least(greatest(coalesce(p_days, 7), 1), 90); since timestamptz; out jsonb;
begin
  if not budgetbuddy.is_platform_admin() then raise exception 'Not allowed' using errcode = '42501'; end if;
  since := now() - make_interval(days => d);
  select jsonb_build_object(
    'days', d,
    'totals', (select jsonb_build_object(
        'requests', count(*), 'ok', count(*) filter (where status = 'ok'), 'failed', count(*) filter (where status = 'error'),
        'pending', count(*) filter (where status = 'pending'),
        'rate_limited', coalesce(sum(rate_limited), 0), 'fallbacks', coalesce(sum(fallbacks), 0),
        'avg_latency_ms', coalesce(round(avg(latency_ms) filter (where status = 'ok')), 0),
        'prompt_tokens', coalesce(sum(prompt_tokens), 0), 'completion_tokens', coalesce(sum(completion_tokens), 0))
      from budgetbuddy.ai_usage where created_at >= since),
    'by_provider_model', coalesce((select jsonb_agg(r order by r.requests desc) from (
        select coalesce(provider, 'none') as provider, coalesce(model, '') as model, count(*) as requests,
               count(*) filter (where status = 'ok') as ok, count(*) filter (where status = 'error') as failed,
               coalesce(round(avg(latency_ms) filter (where status = 'ok')), 0) as avg_latency_ms,
               coalesce(sum(prompt_tokens + completion_tokens), 0) as tokens
          from budgetbuddy.ai_usage where created_at >= since group by 1, 2) r), '[]'::jsonb),
    'errors', coalesce((select jsonb_agg(r order by r.n desc) from (
        select error_kind, count(*) as n from budgetbuddy.ai_usage
         where created_at >= since and status = 'error' group by 1) r), '[]'::jsonb),
    'last_success', (select max(created_at) from budgetbuddy.ai_usage where status = 'ok'),
    'last_failure', (select max(created_at) from budgetbuddy.ai_usage where status = 'error')
  ) into out;
  return out;
end $$;
revoke all on function budgetbuddy.ai_usage_summary(integer) from public, anon;
grant execute on function budgetbuddy.ai_usage_summary(integer) to authenticated;
