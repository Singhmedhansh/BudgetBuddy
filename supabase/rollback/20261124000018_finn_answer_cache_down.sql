-- Rolls back migration 18: removes the shared answer cache and the server's read access to usage.
drop table if exists budgetbuddy.finn_answer_cache;
revoke select on budgetbuddy.ai_usage from service_role;
