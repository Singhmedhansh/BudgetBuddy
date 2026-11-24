-- Rollback of migration 19. The app falls back to ai_reserve_plan and ai_quota (migration 14) on its own.
drop function if exists budgetbuddy.ai_quota_window(integer, integer, timestamptz, timestamptz);
drop function if exists budgetbuddy.ai_reserve_window(integer, integer, integer, integer, timestamptz, integer, timestamptz, text, integer);
drop index if exists budgetbuddy.ai_usage_user_created;
alter table budgetbuddy.ai_usage drop column if exists kind;
alter table budgetbuddy.finn_prefs drop column if exists auto_save_logs;
