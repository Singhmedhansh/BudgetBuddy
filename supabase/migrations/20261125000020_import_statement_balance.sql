-- Migration 20: the closing balance printed on an imported statement.
--
-- Read from the statement text by the server (never by the AI) when the import is prepared. The review screen compares it
-- with what FinTrack will show after the import, and offers one adjustment to match the bank. Null when the statement does
-- not print one or it could not be read with confidence. Covered by the existing table grants and row-level policy.
alter table budgetbuddy.import_jobs
  add column if not exists statement_closing_minor bigint,
  add column if not exists statement_closing_date date;
