-- Rolls back migration 15: removes the thumbs marks.
alter table budgetbuddy.finn_messages drop column if exists feedback;
