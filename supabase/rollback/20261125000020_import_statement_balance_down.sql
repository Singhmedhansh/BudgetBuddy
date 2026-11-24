-- Rollback of migration 20. The app imports without the balance check when these columns are missing.
alter table budgetbuddy.import_jobs drop column if exists statement_closing_minor;
alter table budgetbuddy.import_jobs drop column if exists statement_closing_date;
