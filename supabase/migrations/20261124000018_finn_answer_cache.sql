-- Migration 18: shared answers to general questions, and read access to usage for the owner's dashboard.
--
--   finn_answer_cache   a hash of a general question (no private data is ever in one) and the answer worked out for it,
--                       reused for a week so common questions cost no model call. Server only: row-level security is
--                       on with no policy, nothing is granted to people or visitors.
--   ai_usage            the server's service role may read it, for the usage panel on the review page.
--
-- Rollback: supabase/rollback/20261124000018_finn_answer_cache_down.sql

create table budgetbuddy.finn_answer_cache (
  key text primary key check (char_length(key) = 64),
  answer text not null check (char_length(answer) between 20 and 6000),
  created_at timestamptz not null default now()
);
create index on budgetbuddy.finn_answer_cache (created_at);
alter table budgetbuddy.finn_answer_cache enable row level security;
revoke all on budgetbuddy.finn_answer_cache from anon, authenticated;
grant select, insert, update, delete on budgetbuddy.finn_answer_cache to service_role;

grant select on budgetbuddy.ai_usage to service_role;
