-- Rolls back migration 14. Destroys every saved Finn conversation: export them first if they matter.
drop function if exists budgetbuddy.ai_quota(timestamptz, timestamptz);
drop function if exists budgetbuddy.ai_reserve_plan(integer, integer, timestamptz, integer, timestamptz);
drop table if exists budgetbuddy.finn_messages;
drop table if exists budgetbuddy.finn_conversations;
