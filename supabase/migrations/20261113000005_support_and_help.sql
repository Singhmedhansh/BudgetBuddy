-- Support requests and help-article feedback.
--
-- Both are submitted through security-definer functions with validation and rate
-- limiting, so anonymous visitors (the public Contact page) never get direct
-- table access. Users can read back only their own requests.

create table budgetbuddy.support_requests (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  user_id uuid references auth.users (id) on delete set null,
  email text not null,
  topic text not null check (topic in ('account', 'billing', 'transactions', 'budgets', 'imports', 'bug', 'feedback', 'other')),
  subject text not null check (char_length(subject) between 3 and 150),
  message text not null check (char_length(message) between 10 and 5000),
  attachment_path text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  created_at timestamptz not null default now()
);
create index on budgetbuddy.support_requests (lower(email), created_at desc);
create index on budgetbuddy.support_requests (user_id);

create table budgetbuddy.help_feedback (
  id bigint generated always as identity primary key,
  slug text not null check (char_length(slug) between 1 and 120),
  helpful boolean not null,
  comment text check (comment is null or char_length(comment) <= 1000),
  user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index on budgetbuddy.help_feedback (slug);

alter table budgetbuddy.support_requests enable row level security;
alter table budgetbuddy.help_feedback enable row level security;

-- Signed-in users may read their own requests. Nobody can write directly.
create policy support_read_own on budgetbuddy.support_requests
  for select to authenticated using (user_id = (select auth.uid()));
grant select on budgetbuddy.support_requests to authenticated;
revoke insert, update, delete on budgetbuddy.support_requests from authenticated;
revoke all on budgetbuddy.help_feedback from authenticated;

-- Anonymous visitors need to reach the schema to call the two functions below;
-- they still have no privileges on any table.
grant usage on schema budgetbuddy to anon;

create function budgetbuddy.submit_support_request(
  p_email text, p_topic text, p_subject text, p_message text, p_attachment_path text default null
) returns text
language plpgsql security definer set search_path = '' as $$
declare ref text; uid uuid := (select auth.uid()); recent int; burst int;
begin
  if p_email is null or p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(p_email) > 254 then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  -- Per-address and global limits slow down abuse without needing an IP address.
  select count(*) into recent from budgetbuddy.support_requests
    where lower(email) = lower(p_email) and created_at > now() - interval '1 hour';
  if recent >= 3 then raise exception 'rate_limited' using errcode = '54000'; end if;
  select count(*) into burst from budgetbuddy.support_requests where created_at > now() - interval '10 minutes';
  if burst >= 50 then raise exception 'rate_limited' using errcode = '54000'; end if;
  -- An attachment must live in the caller's own folder.
  if p_attachment_path is not null and (uid is null or split_part(p_attachment_path, '/', 1) <> uid::text) then
    raise exception 'invalid_attachment' using errcode = '22023';
  end if;

  loop
    ref := 'BB-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    exit when not exists (select 1 from budgetbuddy.support_requests where reference = ref);
  end loop;
  insert into budgetbuddy.support_requests (reference, user_id, email, topic, subject, message, attachment_path)
    values (ref, uid, trim(p_email), p_topic, trim(p_subject), trim(p_message), p_attachment_path);
  return ref;
end $$;

create function budgetbuddy.submit_help_feedback(p_slug text, p_helpful boolean, p_comment text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare recent int;
begin
  -- Cap anonymous flooding: at most 200 feedback rows per hour overall.
  select count(*) into recent from budgetbuddy.help_feedback where created_at > now() - interval '1 hour';
  if recent >= 200 then raise exception 'rate_limited' using errcode = '54000'; end if;
  insert into budgetbuddy.help_feedback (slug, helpful, comment, user_id)
    values (p_slug, p_helpful, nullif(trim(p_comment), ''), (select auth.uid()));
end $$;

revoke all on function budgetbuddy.submit_support_request(text, text, text, text, text) from public;
revoke all on function budgetbuddy.submit_help_feedback(text, boolean, text) from public;
grant execute on function budgetbuddy.submit_support_request(text, text, text, text, text) to anon, authenticated;
grant execute on function budgetbuddy.submit_help_feedback(text, boolean, text) to anon, authenticated;

-- Private bucket for support attachments: users may add files only inside their
-- own folder and cannot read them back (staff review them from the dashboard).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('budgetbuddy-support', 'budgetbuddy-support', false, 5242880,
        array['image/png', 'image/jpeg', 'application/pdf', 'text/plain'])
on conflict (id) do nothing;

create policy "budgetbuddy support insert own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'budgetbuddy-support' and (storage.foldername(name))[1] = (select auth.uid())::text);
