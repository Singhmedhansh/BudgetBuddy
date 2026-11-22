/** Migration 14: Finn chat history and plan allowances. Runs the real migrations in-process. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const U = (n: number) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const [ALICE, BOB] = [U(1), U(2)];
let db: PGlite;

async function asUser<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`);
  }
}
const denied = (p: Promise<unknown>) => p.then(() => false, () => true);
const q = <T>(uid: string, sql: string) => asUser(uid, async () => (await db.query<T>(sql)).rows);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, service_role; grant execute on function auth.uid() to authenticated, service_role;
    insert into auth.users values ('${ALICE}'), ('${BOB}');
    create schema storage; create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated, anon; grant select, insert, update, delete on storage.objects to authenticated;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
  `);
  const dir = join(process.cwd(), "supabase/migrations");
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(join(dir, f), "utf8"));
});

describe("saved chats are private", () => {
  let convo = "";
  it("a person saves and reads their own chat", async () => {
    convo = (await q<{ id: string }>(ALICE, `insert into budgetbuddy.finn_conversations (user_id, title) values ('${ALICE}', 'Monitor savings') returning id`))[0].id;
    await q(ALICE, `insert into budgetbuddy.finn_messages (conversation_id, user_id, role, content) values ('${convo}', '${ALICE}', 'user', 'How long to save 7K?')`);
    await q(ALICE, `insert into budgetbuddy.finn_messages (conversation_id, user_id, role, content, source, visuals) values ('${convo}', '${ALICE}', 'assistant', '10 months.', 'model', '[{"type":"stats","items":[]}]')`);
    expect((await q<{ n: number }>(ALICE, `select count(*)::int n from budgetbuddy.finn_messages where conversation_id = '${convo}'`))[0].n).toBe(2);
  });
  it("nobody else can read, write into, rename or delete it", async () => {
    expect((await q<{ n: number }>(BOB, `select count(*)::int n from budgetbuddy.finn_conversations`))[0].n).toBe(0);
    expect((await q<{ n: number }>(BOB, `select count(*)::int n from budgetbuddy.finn_messages`))[0].n).toBe(0);
    expect(await denied(q(BOB, `insert into budgetbuddy.finn_messages (conversation_id, user_id, role, content) values ('${convo}', '${BOB}', 'user', 'hi')`))).toBe(true);
    expect(await denied(q(BOB, `insert into budgetbuddy.finn_messages (conversation_id, user_id, role, content) values ('${convo}', '${ALICE}', 'user', 'hi')`))).toBe(true);
    await q(BOB, `update budgetbuddy.finn_conversations set title = 'hacked'`);
    await q(BOB, `delete from budgetbuddy.finn_conversations`);
    expect((await q<{ title: string }>(ALICE, `select title from budgetbuddy.finn_conversations`))[0].title).toBe("Monitor savings");
  });
  it("enforces shapes: roles, length, and chart size", async () => {
    expect(await denied(q(ALICE, `insert into budgetbuddy.finn_messages (conversation_id, user_id, role, content) values ('${convo}', '${ALICE}', 'system', 'x')`))).toBe(true);
    expect(await denied(q(ALICE, `insert into budgetbuddy.finn_messages (conversation_id, user_id, role, content) values ('${convo}', '${ALICE}', 'user', '')`))).toBe(true);
    expect(await denied(q(ALICE, `insert into budgetbuddy.finn_conversations (user_id, title) values ('${ALICE}', '')`))).toBe(true);
  });
  it("deleting a chat deletes its messages", async () => {
    await q(ALICE, `delete from budgetbuddy.finn_conversations where id = '${convo}'`);
    expect((await q<{ n: number }>(ALICE, `select count(*)::int n from budgetbuddy.finn_messages`))[0].n).toBe(0);
  });
});

describe("plan allowances", () => {
  const dayStart = "now() - interval '2 hours'";
  const monthStart = "now() - interval '10 days'";
  const reserve = (uid: string, perHour: number, perDay: number, perMonth: number) =>
    q<{ r: { allowed: boolean; reason?: string; id?: number } }>(uid, `select budgetbuddy.ai_reserve_plan(${perHour}, ${perDay}, ${dayStart}, ${perMonth}, ${monthStart}) as r`).then((x) => x[0].r);

  it("stops at the questions-per-day allowance, and failed tries do not count", async () => {
    const a = await reserve(ALICE, 99, 2, 1_000_000);
    expect(a.allowed).toBe(true);
    await q(ALICE, `select budgetbuddy.ai_settle(${a.id}, 'error', null, null, 0, 0, 10)`);
    const b = await reserve(ALICE, 99, 2, 1_000_000);
    const c = await reserve(ALICE, 99, 2, 1_000_000);
    expect(b.allowed && c.allowed).toBe(true);
    expect(await reserve(ALICE, 99, 2, 1_000_000)).toMatchObject({ allowed: false, reason: "plan_day" });
  });
  it("stops at the monthly token allowance", async () => {
    await q(BOB, `select budgetbuddy.ai_settle(${(await reserve(BOB, 99, 50, 1000)).id}, 'ok', 'groq', 'm', 900, 200, 10)`);
    expect(await reserve(BOB, 99, 50, 1000)).toMatchObject({ allowed: false, reason: "plan_month" });
  });
  it("reports usage for the meter", async () => {
    const [{ r }] = await q<{ r: { questions_today: number; tokens_month: number } }>(BOB, `select budgetbuddy.ai_quota(${dayStart}, ${monthStart}) as r`);
    expect(r.questions_today).toBe(1);
    expect(r.tokens_month).toBe(1100);
  });
});
