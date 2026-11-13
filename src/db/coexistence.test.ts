/**
 * Coexistence with another application in the same Supabase project. The stand-in
 * "other app" mirrors HireCheck's shape: a public.profiles table filled by an
 * unconditional trigger on auth.users. FinTrack's migrations must not touch
 * it, add their own auth trigger, or create anything in `public`, and Budget
 * Buddy's profile creation must never write into the other app's tables.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const ALICE = "00000000-0000-0000-0000-00000000000a";
const OTHER_APP_USER = "00000000-0000-0000-0000-0000000000ff";
let db: PGlite;

async function as<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`);
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth; create table auth.users (id uuid primary key, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    create schema storage; create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;

    -- the "other app": same shape as HireCheck's signup trigger
    create table public.profiles (id uuid primary key, full_name text not null default '');
    create table public.preferences (user_id uuid primary key);
    create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
      begin
        insert into public.profiles (id, full_name) values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
        insert into public.preferences (user_id) values (new.id);
        return new;
      end $$;
    create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
    insert into auth.users (id) values ('${OTHER_APP_USER}');
  `);
  const dir = join(process.cwd(), "supabase/migrations");
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(join(dir, f), "utf8"));
});

describe("coexistence with another app on the same project", () => {
  it("migrations add no trigger to auth.users (only the other app's remains)", async () => {
    const r = await db.query<{ tgname: string }>(`select tgname from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal`);
    expect(r.rows.map((x) => x.tgname)).toEqual(["on_auth_user_created"]);
  });

  it("migrations create nothing in the public schema beyond what the other app owns", async () => {
    const tables = await db.query<{ n: string }>(`select tablename n from pg_tables where schemaname = 'public' order by 1`);
    expect(tables.rows.map((x) => x.n)).toEqual(["preferences", "profiles"]);
    const fns = await db.query<{ n: string }>(
      `select proname n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' order by 1`,
    );
    expect(fns.rows.map((x) => x.n)).toEqual(["handle_new_user"]);
    const views = await db.query(`select 1 from pg_views where schemaname = 'public'`);
    expect(views.rows).toHaveLength(0);
  });

  it("ensure_profile writes only to budgetbuddy.profiles and never to the other app's tables", async () => {
    const before = (await db.query<{ n: string }>(`select count(*) n from public.profiles`)).rows[0].n;
    await db.exec(`insert into auth.users (id) values ('${ALICE}')`); // fires the OTHER app's trigger, not ours
    const afterSignup = (await db.query<{ n: string }>(`select count(*) n from public.profiles`)).rows[0].n;
    expect(Number(afterSignup)).toBe(Number(before) + 1); // the other app's own behaviour, unchanged

    await as(ALICE, () => db.query(`select * from budgetbuddy.ensure_profile()`));
    await as(ALICE, () => db.query(`select * from budgetbuddy.ensure_profile()`)); // idempotent
    const afterEnsure = (await db.query<{ n: string }>(`select count(*) n from public.profiles`)).rows[0].n;
    expect(afterEnsure).toBe(afterSignup);
    const bb = await db.query(`select 1 from budgetbuddy.profiles where user_id = '${ALICE}'`);
    expect(bb.rows).toHaveLength(1);
  });

  it("FinTrack never creates a profile for a user until that user actually uses it", async () => {
    const r = await db.query(`select 1 from budgetbuddy.profiles where user_id = '${OTHER_APP_USER}'`);
    expect(r.rows).toHaveLength(0);
  });

  it("another app's user can use FinTrack only as themselves and sees none of its data", async () => {
    await as(OTHER_APP_USER, () => db.query(`select * from budgetbuddy.ensure_profile()`));
    const rows = await as(OTHER_APP_USER, async () => ({
      profiles: (await db.query(`select 1 from budgetbuddy.profiles`)).rows.length,
      spaces: (await db.query(`select 1 from budgetbuddy.financial_spaces`)).rows.length,
    }));
    expect(rows).toEqual({ profiles: 1, spaces: 0 }); // only their own row; Alice's profile is invisible
  });

  it("anonymous callers cannot create a profile", async () => {
    await db.exec(`set role anon`);
    const denied = await db.query(`select * from budgetbuddy.ensure_profile()`).then(() => false, () => true);
    await db.exec(`reset role`);
    expect(denied).toBe(true);
  });
});
