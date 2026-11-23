-- Migration 17: lets the server's service role reach the tables Finn's background work uses.
--
-- The weekly recap job, the WhatsApp handler and the review queue run on the server with the service role. Row-level
-- security does not apply to it, but it still needs table privileges, which a custom schema does not hand out by itself.
-- Only what each job needs is granted, and nothing is granted to people or to anonymous visitors.
--
--   finn_prefs        read who wants the recap, record when one was sent
--   whatsapp_links    read and verify links, keep a pending confirmation
--   whatsapp_seen     remember handled message ids
--   finn_messages     read thumbs-down answers and the questions before them, mark them reviewed
--
-- Rollback: supabase/rollback/20261124000017_finn_service_grants_down.sql

grant usage on schema budgetbuddy to service_role;
grant select, update on budgetbuddy.finn_prefs to service_role;
grant select, update, delete on budgetbuddy.whatsapp_links to service_role;
grant select, insert on budgetbuddy.whatsapp_seen to service_role;
grant select, update on budgetbuddy.finn_messages to service_role;
