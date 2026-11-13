-- CSV imports: parse -> review -> commit. Nothing reaches the ledger until the
-- user confirms. Commit is atomic per row and idempotent: each imported
-- transaction stores a fingerprint as its external_id, and the existing unique
-- (space_id, source, external_id) constraint makes a repeat import a no-op.

create table budgetbuddy.import_jobs (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references budgetbuddy.financial_spaces (id) on delete cascade,
  account_id uuid not null references budgetbuddy.accounts (id),
  filename text not null check (char_length(filename) <= 200),
  status text not null default 'preview' check (status in ('preview', 'committed', 'cancelled')),
  rows jsonb not null,
  problems jsonb not null default '[]'::jsonb,
  summary jsonb,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  committed_at timestamptz
);
create index on budgetbuddy.import_jobs (space_id, created_at desc);

alter table budgetbuddy.import_jobs enable row level security;
-- Statements are sensitive: editors only (not viewers) for every operation.
create policy import_jobs_editor on budgetbuddy.import_jobs for all to authenticated
  using (budgetbuddy.has_space_role(space_id, 'editor'))
  with check (budgetbuddy.has_space_role(space_id, 'editor') and created_by = (select auth.uid()));
grant select, insert, update on budgetbuddy.import_jobs to authenticated;

create function budgetbuddy.check_import_job() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from budgetbuddy.accounts a where a.id = new.account_id and a.space_id = new.space_id) then
    raise exception 'Account does not belong to this space' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger import_jobs_valid before insert or update on budgetbuddy.import_jobs
  for each row execute function budgetbuddy.check_import_job();

-- Each row: {line, occurred_at, description, amount (signed minor units: + in, - out),
--            fingerprint, category_id, include (boolean)}
create function budgetbuddy.commit_import(p_job uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  j budgetbuddy.import_jobs; r jsonb; cur text;
  imported int := 0; skipped int := 0; excluded int := 0; amt bigint; entries jsonb;
begin
  select * into j from budgetbuddy.import_jobs where id = p_job;
  if not found then raise exception 'Import not found' using errcode = 'P0002'; end if;
  if j.status <> 'preview' then raise exception 'This import was already finished' using errcode = '23514'; end if;
  select currency into cur from budgetbuddy.accounts where id = j.account_id;

  for r in select * from jsonb_array_elements(j.rows) loop
    if not coalesce((r->>'include')::boolean, false) then
      excluded := excluded + 1;
      continue;
    end if;
    amt := (r->>'amount')::bigint;
    if amt = 0 then continue; end if;
    entries := jsonb_build_array(
      jsonb_build_object('account_id', j.account_id, 'amount', amt),
      jsonb_build_object('category_id', r->>'category_id', 'amount', -amt));
    begin
      perform budgetbuddy.post_transaction(
        j.space_id,
        case when amt > 0 then 'income'::budgetbuddy.txn_type else 'expense'::budgetbuddy.txn_type end,
        (r->>'occurred_at')::timestamptz, cur, abs(amt), entries,
        left(r->>'description', 120), r->>'description', null,
        'posted', 'import', r->>'fingerprint', null);
      imported := imported + 1;
    exception when unique_violation then
      skipped := skipped + 1;      -- already imported before: safe no-op
    end;
  end loop;

  update budgetbuddy.import_jobs
    set status = 'committed', committed_at = now(),
        summary = jsonb_build_object('imported', imported, 'skipped_already_imported', skipped, 'excluded', excluded)
    where id = p_job;
  return jsonb_build_object('imported', imported, 'skipped_already_imported', skipped, 'excluded', excluded);
end $$;

revoke all on function budgetbuddy.commit_import(uuid) from public, anon;
grant execute on function budgetbuddy.commit_import(uuid) to authenticated;
