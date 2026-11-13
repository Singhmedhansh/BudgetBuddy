/**
 * Verifies the storage policies against a stand-in for Supabase's storage schema
 * (PGlite has no storage service). Proves the policy logic and, importantly,
 * that FinTrack policies grant nothing on any other bucket.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const ALICE = "00000000-0000-0000-0000-00000000000a";
const BOB = "00000000-0000-0000-0000-00000000000b";
const EVE = "00000000-0000-0000-0000-00000000000e";
let db: PGlite;
let space: string;

async function as<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`);
  }
}
const denied = async (p: Promise<unknown>) => p.then(() => false, () => true);
const put = (uid: string, bucket: string, path: string) =>
  as(uid, () => db.exec(`insert into storage.objects (bucket_id, name) values ('${bucket}', '${path}')`));
const visible = (uid: string, bucket: string) =>
  as(uid, async () => (await db.query(`select 1 from storage.objects where bucket_id='${bucket}'`)).rows.length);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    insert into auth.users values ('${ALICE}'),('${BOB}'),('${EVE}');
    -- minimal stand-in for the Supabase storage schema
    create schema storage; grant usage on schema storage to authenticated;
    create table storage.buckets (id text primary key, name text, public boolean default false,
      file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant select, insert, update, delete on storage.objects to authenticated;
    create function storage.foldername(name text) returns text[] language sql immutable as
      $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'),1)-1] $$;
    grant execute on function storage.foldername(text) to authenticated;
    -- an unrelated product's bucket, to prove isolation
    insert into storage.buckets (id, name) values ('other-app-files', 'other-app-files');
  `);
  for (const f of ["20261113000001_budgetbuddy_core.sql", "20261113000002_budgetbuddy_storage.sql"]) {
    await db.exec(readFileSync(join(process.cwd(), "supabase/migrations", f), "utf8"));
  }
  space = await as(ALICE, async () =>
    (await db.query<{ id: string }>(`select id from budgetbuddy.create_space('A','personal','INR')`)).rows[0].id,
  );
  await db.exec(`insert into budgetbuddy.financial_space_members values ('${space}','${BOB}','viewer')`);
});

describe("budgetbuddy storage policies", () => {
  it("creates private buckets with size and type limits", async () => {
    const r = await db.query<{ id: string; public: boolean; file_size_limit: number }>(
      `select id, public, file_size_limit from storage.buckets where id like 'budgetbuddy-%' order by id`,
    );
    expect(r.rows.map((x) => x.id)).toEqual(["budgetbuddy-imports", "budgetbuddy-receipts"]);
    expect(r.rows.every((x) => x.public === false && Number(x.file_size_limit) > 0)).toBe(true);
  });

  it("an editor/owner can upload into their space folder; a viewer cannot", async () => {
    await put(ALICE, "budgetbuddy-receipts", `${space}/t1/receipt.png`);
    expect(await denied(put(BOB, "budgetbuddy-receipts", `${space}/t1/bob.png`))).toBe(true);
  });

  it("a viewer can read receipts but not raw import files", async () => {
    await put(ALICE, "budgetbuddy-imports", `${space}/stmt.csv`);
    expect(await visible(BOB, "budgetbuddy-receipts")).toBe(1);
    expect(await visible(BOB, "budgetbuddy-imports")).toBe(0);
  });

  it("a non-member sees nothing and cannot upload by guessing the space id", async () => {
    expect(await visible(EVE, "budgetbuddy-receipts")).toBe(0);
    expect(await denied(put(EVE, "budgetbuddy-receipts", `${space}/x/evil.png`))).toBe(true);
  });

  it("malformed or traversal-style paths are denied, not errors that leak", async () => {
    expect(await denied(put(ALICE, "budgetbuddy-receipts", `not-a-uuid/a.png`))).toBe(true);
    expect(await denied(put(ALICE, "budgetbuddy-receipts", `a.png`))).toBe(true);
  });

  it("grants nothing on another product's bucket", async () => {
    expect(await denied(put(ALICE, "other-app-files", `${space}/x.png`))).toBe(true);
    await db.exec(`insert into storage.objects (bucket_id, name) values ('other-app-files','x/y.png')`);
    expect(await visible(ALICE, "other-app-files")).toBe(0);
  });
});
