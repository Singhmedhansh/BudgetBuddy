-- Migration 15: thumbs up / down on Finn's answers.
--
--   finn_messages.feedback   'up' or 'down', set by the person on an answer of theirs. Nothing else on a message can be
--                            changed after it is written, and only the person who owns it can set the mark.
--
-- Rollback: supabase/rollback/20261123000015_finn_feedback_down.sql
alter table budgetbuddy.finn_messages add column feedback text check (feedback is null or feedback in ('up', 'down'));
grant update (feedback) on budgetbuddy.finn_messages to authenticated;
