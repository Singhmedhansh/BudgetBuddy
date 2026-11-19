-- ROLLBACK for migration 11 (AI monitoring and platform admin). NOT run automatically.
-- Roll back migration 12 first: its policies call is_platform_admin().
--
-- DESTROYS: the platform_admins list (re-insert your admins after re-applying) and the four new ai_usage columns
-- (error_kind, attempts, fallbacks, rate_limited). Per-person AI limits keep working: ai_reserve is untouched and
-- ai_settle is restored to its original 7-argument form below, which the app's older code calls.
-- Recovery: re-apply the migration file.

drop function if exists budgetbuddy.ai_usage_summary(integer);
drop function if exists budgetbuddy.is_platform_admin();
drop table if exists budgetbuddy.platform_admins;

drop function if exists budgetbuddy.ai_settle(bigint, text, text, text, integer, integer, integer, text, integer, integer, integer);
create function budgetbuddy.ai_settle(p_id bigint, p_status text, p_provider text, p_model text, p_prompt integer, p_completion integer, p_latency integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('ok', 'error') then raise exception 'Invalid status' using errcode = '22023'; end if;
  update budgetbuddy.ai_usage
     set status = p_status, provider = p_provider, model = p_model,
         prompt_tokens = greatest(0, p_prompt), completion_tokens = greatest(0, p_completion), latency_ms = p_latency
   where id = p_id and user_id = (select auth.uid()) and status = 'pending';
end $$;
revoke all on function budgetbuddy.ai_settle(bigint, text, text, text, integer, integer, integer) from public, anon;
grant execute on function budgetbuddy.ai_settle(bigint, text, text, text, integer, integer, integer) to authenticated;

drop index if exists budgetbuddy.ai_usage_created_at_idx;
alter table budgetbuddy.ai_usage drop column if exists error_kind, drop column if exists attempts, drop column if exists fallbacks, drop column if exists rate_limited;
