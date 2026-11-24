-- Rolls back migration 16: removes the weekly-recap opt-in, the WhatsApp links and the review marks.
drop index if exists budgetbuddy.finn_messages_created_at_idx;
alter table budgetbuddy.finn_messages drop column if exists reviewed_at;
drop function if exists budgetbuddy.finn_whatsapp_start(text);
drop table if exists budgetbuddy.whatsapp_seen;
drop table if exists budgetbuddy.whatsapp_links;
drop table if exists budgetbuddy.finn_prefs;
