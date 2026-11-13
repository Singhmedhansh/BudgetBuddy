-- Budget Buddy storage: two private buckets, access derived from space membership.
--
-- Coexistence with other products in this project:
--   * Buckets are namespaced `budgetbuddy-*` and every policy below is scoped to
--     those bucket ids, so no other bucket (or future bucket) is affected.
--   * Policies are permissive and only match Budget Buddy bucket ids; they grant
--     nothing on any other bucket.
--   * Object paths are `<space_id>/<...>`; access is decided by the caller's role
--     in that space, never by a client-supplied value alone.

-- Returns NULL instead of raising on a malformed uuid, so a bad path simply
-- denies access.
create function budgetbuddy.try_uuid(p text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('budgetbuddy-receipts', 'budgetbuddy-receipts', false, 5242880,
   array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('budgetbuddy-imports', 'budgetbuddy-imports', false, 10485760,
   array['text/csv', 'application/vnd.ms-excel',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;

-- Receipts: members read, editors write, admins delete.
create policy "budgetbuddy receipts read" on storage.objects
  for select to authenticated
  using (bucket_id = 'budgetbuddy-receipts'
         and budgetbuddy.has_space_role(budgetbuddy.try_uuid((storage.foldername(name))[1]), 'viewer'));

create policy "budgetbuddy receipts insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'budgetbuddy-receipts'
              and budgetbuddy.has_space_role(budgetbuddy.try_uuid((storage.foldername(name))[1]), 'editor'));

create policy "budgetbuddy receipts delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'budgetbuddy-receipts'
         and budgetbuddy.has_space_role(budgetbuddy.try_uuid((storage.foldername(name))[1]), 'admin'));

-- Raw import files contain statements: editors only, for read, write and delete.
create policy "budgetbuddy imports read" on storage.objects
  for select to authenticated
  using (bucket_id = 'budgetbuddy-imports'
         and budgetbuddy.has_space_role(budgetbuddy.try_uuid((storage.foldername(name))[1]), 'editor'));

create policy "budgetbuddy imports insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'budgetbuddy-imports'
              and budgetbuddy.has_space_role(budgetbuddy.try_uuid((storage.foldername(name))[1]), 'editor'));

create policy "budgetbuddy imports delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'budgetbuddy-imports'
         and budgetbuddy.has_space_role(budgetbuddy.try_uuid((storage.foldername(name))[1]), 'editor'));
