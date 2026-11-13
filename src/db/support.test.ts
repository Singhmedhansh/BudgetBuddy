import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const ALICE = "00000000-0000-0000-0000-00000000000a";
const BOB = "00000000-0000-0000-0000-00000000000b";
let db: PGlite;

async function as<T>(role: "anon" | "authenticated", uid: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${uid}',false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`);
  }
}
const denied = async (p: Promise<unknown>) => p.then(() => false, () => true);
const submit = (role: "anon" | "authenticated", uid: string, email: string, msg = "I cannot find my transactions", attach = "null") =>
  as(role, uid, async () =>
    (await db.query<{ r: string }>(`select budgetbuddy.submit_support_request('${email}','transactions','Missing data','${msg}', ${attach}) r`)).rows[0].r,
  );

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
    insert into auth.users values ('${ALICE}'),('${BOB}');
    create schema storage; grant usage on schema storage to authenticated;
    create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant select, insert on storage.objects to authenticated;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
    grant execute on function storage.foldername(text) to authenticated;
  `);
  const dir = join(process.cwd(), "supabase/migrations");
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(join(dir, f), "utf8"));
});

describe("support requests", () => {
  it("an anonymous visitor can submit and receives a reference", async () => {
    const ref = await submit("anon", "", "visitor@example.com");
    expect(ref).toMatch(/^BB-[A-F0-9]{8}$/);
  });

  it("references are unique", async () => {
    const a = await submit("authenticated", ALICE, "alice1@example.com");
    const b = await submit("authenticated", ALICE, "alice2@example.com");
    expect(a).not.toBe(b);
  });

  it("rejects invalid email, short messages and unknown topics", async () => {
    expect(await denied(submit("anon", "", "not-an-email"))).toBe(true);
    expect(await denied(submit("anon", "", "ok@example.com", "short"))).toBe(true);
    expect(await denied(as("anon", "", () => db.query(`select budgetbuddy.submit_support_request('a@example.com','hacking','Subject here','A long enough message', null)`)))).toBe(true);
  });

  it("rate-limits repeated submissions from the same address", async () => {
    for (let i = 0; i < 3; i++) await submit("anon", "", "spammer@example.com");
    expect(await denied(submit("anon", "", "spammer@example.com"))).toBe(true);
    expect(await denied(submit("anon", "", "SPAMMER@example.com"))).toBe(true); // case-insensitive
  });

  it("nobody can write or read the table directly; users read only their own requests", async () => {
    expect(await denied(as("anon", "", () => db.query(`select * from budgetbuddy.support_requests`)))).toBe(true);
    expect(await denied(as("authenticated", ALICE, () => db.exec(`insert into budgetbuddy.support_requests (reference,email,topic,subject,message) values ('X','a@b.co','bug','Subject','Message long enough')`)))).toBe(true);
    await submit("authenticated", ALICE, "alice3@example.com");
    const mine = await as("authenticated", ALICE, async () => (await db.query(`select 1 from budgetbuddy.support_requests`)).rows.length);
    const bobs = await as("authenticated", BOB, async () => (await db.query(`select 1 from budgetbuddy.support_requests`)).rows.length);
    expect(mine).toBeGreaterThan(0);
    expect(bobs).toBe(0);
  });

  it("an attachment path is accepted only inside the caller's own folder", async () => {
    expect(await denied(submit("anon", "", "x1@example.com", "I cannot find my transactions", `'${ALICE}/t/file.png'`))).toBe(true);
    expect(await denied(submit("authenticated", ALICE, "x2@example.com", "I cannot find my transactions", `'${BOB}/t/file.png'`))).toBe(true);
    await expect(submit("authenticated", ALICE, "x3@example.com", "I cannot find my transactions", `'${ALICE}/t/file.png'`)).resolves.toBeTruthy();
  });

  it("support attachments: own folder only, no read-back", async () => {
    await as("authenticated", ALICE, () => db.exec(`insert into storage.objects (bucket_id,name) values ('budgetbuddy-support','${ALICE}/t1/a.png')`));
    expect(await denied(as("authenticated", ALICE, () => db.exec(`insert into storage.objects (bucket_id,name) values ('budgetbuddy-support','${BOB}/t1/a.png')`)))).toBe(true);
    const visible = await as("authenticated", ALICE, async () => (await db.query(`select 1 from storage.objects where bucket_id='budgetbuddy-support'`)).rows.length);
    expect(visible).toBe(0);
  });
});

describe("help feedback", () => {
  it("anyone can record feedback, but nobody can read or write the table", async () => {
    await as("anon", "", () => db.query(`select budgetbuddy.submit_help_feedback('add-an-account', true, null)`));
    await as("authenticated", ALICE, () => db.query(`select budgetbuddy.submit_help_feedback('add-an-account', false, 'Missing a step')`));
    expect(await denied(as("authenticated", ALICE, () => db.query(`select * from budgetbuddy.help_feedback`)))).toBe(true);
    expect(await denied(as("anon", "", () => db.exec(`insert into budgetbuddy.help_feedback (slug, helpful) values ('x', true)`)))).toBe(true);
  });
});
