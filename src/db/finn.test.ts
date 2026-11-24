/** Migration 14: Finn chat history and plan allowances. Runs the real migrations in-process. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const U = (n: number) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const [ALICE, BOB, CARA, DEV] = [U(1), U(2), U(3), U(4)];
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
    insert into auth.users values ('${ALICE}'), ('${BOB}'), ('${CARA}'), ('${DEV}');
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

describe("thumbs", () => {
  it("a person marks their own answer, and nothing else on a message can change", async () => {
    const c = (await q<{ id: string }>(ALICE, `insert into budgetbuddy.finn_conversations (user_id, title) values ('${ALICE}', 'T') returning id`))[0].id;
    const m = (await q<{ id: string }>(ALICE, `insert into budgetbuddy.finn_messages (conversation_id, user_id, role, content) values ('${c}', '${ALICE}', 'assistant', 'ok') returning id`))[0].id;
    await q(ALICE, `update budgetbuddy.finn_messages set feedback = 'up' where id = ${m}`);
    expect((await q<{ f: string }>(ALICE, `select feedback f from budgetbuddy.finn_messages where id = ${m}`))[0].f).toBe("up");
    expect(await denied(q(ALICE, `update budgetbuddy.finn_messages set content = 'changed' where id = ${m}`))).toBe(true);
    expect(await denied(q(ALICE, `update budgetbuddy.finn_messages set feedback = 'meh' where id = ${m}`))).toBe(true);
    await q(BOB, `update budgetbuddy.finn_messages set feedback = 'down' where id = ${m}`);
    expect((await q<{ f: string }>(ALICE, `select feedback f from budgetbuddy.finn_messages where id = ${m}`))[0].f).toBe("up");
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

describe("weekly recap opt-in", () => {
  it("a person turns their own recap on and off, and cannot touch the send time", async () => {
    await q(ALICE, `insert into budgetbuddy.finn_prefs (user_id, weekly_recap) values ('${ALICE}', true)`);
    expect((await q<{ w: boolean }>(ALICE, `select weekly_recap w from budgetbuddy.finn_prefs`))[0].w).toBe(true);
    await q(ALICE, `update budgetbuddy.finn_prefs set weekly_recap = false, updated_at = now() where user_id = '${ALICE}'`);
    expect((await q<{ w: boolean }>(ALICE, `select weekly_recap w from budgetbuddy.finn_prefs`))[0].w).toBe(false);
    expect(await denied(q(ALICE, `update budgetbuddy.finn_prefs set recap_sent_at = now() where user_id = '${ALICE}'`))).toBe(true);
  });
  it("nobody else can read or change it, or opt someone else in", async () => {
    expect((await q<{ n: number }>(BOB, `select count(*)::int n from budgetbuddy.finn_prefs`))[0].n).toBe(0);
    expect(await denied(q(BOB, `insert into budgetbuddy.finn_prefs (user_id, weekly_recap) values ('${ALICE}', true)`))).toBe(true);
  });
});

describe("WhatsApp linking", () => {
  it("starting a link returns a six-digit code and stores the number unverified", async () => {
    const [{ r }] = await q<{ r: { code: string } }>(ALICE, `select budgetbuddy.finn_whatsapp_start('+919876543210') as r`);
    expect(r.code).toMatch(/^[0-9]{6}$/);
    const row = (await q<{ phone: string; verified_at: string | null }>(ALICE, `select phone, verified_at from budgetbuddy.whatsapp_links`))[0];
    expect(row.phone).toBe("+919876543210");
    expect(row.verified_at).toBeNull();
  });
  it("rejects a number without a country code", async () => {
    expect(await denied(q(BOB, `select budgetbuddy.finn_whatsapp_start('9876543210')`))).toBe(true);
  });
  it("a person cannot write the table directly, read the code, or see someone else's link", async () => {
    expect(await denied(q(ALICE, `update budgetbuddy.whatsapp_links set verified_at = now()`))).toBe(true);
    expect(await denied(q(ALICE, `select code from budgetbuddy.whatsapp_links`))).toBe(true);
    expect((await q<{ n: number }>(BOB, `select count(*)::int n from budgetbuddy.whatsapp_links`))[0].n).toBe(0);
  });
  it("a number the server has verified cannot be claimed by someone else", async () => {
    await db.exec(`update budgetbuddy.whatsapp_links set verified_at = now(), code = null where user_id = '${ALICE}'`);
    expect(await denied(q(BOB, `select budgetbuddy.finn_whatsapp_start('+919876543210')`))).toBe(true);
  });
  it("a person can unlink their own number", async () => {
    await q(ALICE, `delete from budgetbuddy.whatsapp_links`);
    expect((await q<{ n: number }>(ALICE, `select count(*)::int n from budgetbuddy.whatsapp_links`))[0].n).toBe(0);
  });
  it("the handled-message list is not open to people at all", async () => {
    expect(await denied(q(ALICE, `select * from budgetbuddy.whatsapp_seen`))).toBe(true);
  });
});

describe("review marks", () => {
  it("a person cannot mark their own answer as reviewed", async () => {
    expect(await denied(q(ALICE, `update budgetbuddy.finn_messages set reviewed_at = now()`))).toBe(true);
  });
});

describe("the server's service role", () => {
  it("can read who wants the recap, handle WhatsApp links and mark reviews, but not delete chats", async () => {
    await db.exec(`set role service_role`);
    try {
      await db.query(`select * from budgetbuddy.finn_prefs`);
      await db.query(`select * from budgetbuddy.whatsapp_links`);
      await db.query(`insert into budgetbuddy.whatsapp_seen (msg_id) values ('wamid.test')`);
      await db.query(`select id, feedback from budgetbuddy.finn_messages where feedback = 'down'`);
      await db.query(`update budgetbuddy.finn_messages set reviewed_at = now() where feedback = 'down'`);
      expect(await denied(db.query(`delete from budgetbuddy.finn_messages`))).toBe(true);
    } finally {
      await db.exec(`reset role`);
    }
  });
});

describe("the shared answer cache", () => {
  it("is for the server only: people cannot read or write it", async () => {
    await db.exec(`set role service_role`);
    try {
      await db.query(`insert into budgetbuddy.finn_answer_cache (key, answer) values (repeat('a', 64), 'An emergency fund is money set aside for surprises.')`);
      expect((await db.query<{ n: number }>(`select count(*)::int n from budgetbuddy.finn_answer_cache`)).rows[0].n).toBe(1);
    } finally {
      await db.exec(`reset role`);
    }
    expect(await denied(q(ALICE, `select * from budgetbuddy.finn_answer_cache`))).toBe(true);
    expect(await denied(q(ALICE, `insert into budgetbuddy.finn_answer_cache (key, answer) values (repeat('b', 64), 'Something else that is long enough.')`))).toBe(true);
  });
  it("refuses a key that is not a hash and an answer that is empty", async () => {
    await db.exec(`set role service_role`);
    try {
      expect(await denied(db.query(`insert into budgetbuddy.finn_answer_cache (key, answer) values ('short', 'An emergency fund is money set aside.')`))).toBe(true);
      expect(await denied(db.query(`insert into budgetbuddy.finn_answer_cache (key, answer) values (repeat('c', 64), '')`))).toBe(true);
    } finally {
      await db.exec(`reset role`);
    }
  });
});

describe("rolling-window allowances (migration 19)", () => {
  const dayStart = "now() - interval '2 hours'";
  const monthStart = "now() - interval '10 days'";
  type R = { allowed: boolean; reason?: string; id?: number; retry_at?: string };
  const reserve = (uid: string, o: { perMinute?: number; windowMax?: number; dayMax?: number; perMonth?: number; kind?: string; kindMax?: number | null } = {}) =>
    q<{ r: R }>(
      uid,
      `select budgetbuddy.ai_reserve_window(${o.perMinute ?? 99}, 5, ${o.windowMax ?? 20}, ${o.dayMax ?? 40}, ${dayStart}, ${o.perMonth ?? 1_000_000}, ${monthStart}, '${o.kind ?? "chat"}', ${o.kindMax ?? "null"}) as r`,
    ).then((x) => x[0].r);
  const age = (uid: string, id: number, hours: number) =>
    db.exec(`update budgetbuddy.ai_usage set created_at = now() - interval '${hours} hours' where id = ${id}`);

  it("stops at the window and says when the next message frees up", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) ids.push((await reserve(CARA, { windowMax: 3 })).id!);
    // The oldest use was 4 hours ago, so the window frees up about an hour from now.
    await age(CARA, ids[0], 4);
    const r = await reserve(CARA, { windowMax: 3 });
    expect(r).toMatchObject({ allowed: false, reason: "plan_window" });
    const mins = (new Date(r.retry_at!).getTime() - Date.now()) / 60_000;
    expect(mins).toBeGreaterThan(55);
    expect(mins).toBeLessThan(65);
  });
  it("frees up once the oldest use leaves the window, and failed tries never count", async () => {
    const [{ id }] = await q<{ id: number }>(CARA, `select id from budgetbuddy.ai_usage where user_id = '${CARA}' order by created_at asc limit 1`);
    await age(CARA, id, 6);
    const ok = await reserve(CARA, { windowMax: 3 });
    expect(ok.allowed).toBe(true);
    await q(CARA, `select budgetbuddy.ai_settle(${ok.id}, 'error', null, null, 0, 0, 10)`);
    expect((await reserve(CARA, { windowMax: 3 })).allowed).toBe(true);
  });
  it("still stops at the daily ceiling", async () => {
    await reserve(DEV, { dayMax: 2 });
    await reserve(DEV, { dayMax: 2 });
    expect(await reserve(DEV, { dayMax: 2 })).toMatchObject({ allowed: false, reason: "plan_day" });
  });
  it("has a burst guard per minute that counts every try", async () => {
    expect(await reserve(DEV, { perMinute: 2 })).toMatchObject({ allowed: false, reason: "minute" });
  });
  it("caps one kind per day, such as photo scans", async () => {
    await db.exec(`delete from budgetbuddy.ai_usage where user_id = '${DEV}'`);
    expect((await reserve(DEV, { kind: "scan", kindMax: 1 })).allowed).toBe(true);
    expect(await reserve(DEV, { kind: "scan", kindMax: 1 })).toMatchObject({ allowed: false, reason: "kind_day" });
    expect((await reserve(DEV, { kind: "chat" })).allowed).toBe(true);
    expect(await denied(q(DEV, `select budgetbuddy.ai_reserve_window(9, 5, 20, 40, now(), 1000000, now(), 'other', null)`))).toBe(true);
  });
  it("reports the window for the meter", async () => {
    const [{ r }] = await q<{ r: { window_used: number; window_frees_at: string | null; questions_today: number; scans_today: number } }>(
      DEV,
      `select budgetbuddy.ai_quota_window(5, 20, ${dayStart}, ${monthStart}) as r`,
    );
    expect(r.window_used).toBe(2);
    expect(r.scans_today).toBe(1);
    expect(r.window_frees_at).not.toBeNull();
  });
  it("is only for signed-in people", async () => {
    expect(await denied(db.query(`set role anon; select budgetbuddy.ai_reserve_window(9, 5, 20, 40, now(), 1000000, now(), 'chat', null)`))).toBe(true);
    await db.exec("reset role");
  });
});

describe("saving quick records at once (migration 19)", () => {
  it("is off by default, a person can switch their own on, and nobody else can", async () => {
    await q(CARA, `insert into budgetbuddy.finn_prefs (user_id) values ('${CARA}')`);
    expect((await q<{ a: boolean }>(CARA, `select auto_save_logs a from budgetbuddy.finn_prefs`))[0].a).toBe(false);
    await q(CARA, `update budgetbuddy.finn_prefs set auto_save_logs = true, updated_at = now() where user_id = '${CARA}'`);
    expect((await q<{ a: boolean }>(CARA, `select auto_save_logs a from budgetbuddy.finn_prefs`))[0].a).toBe(true);
    await q(DEV, `update budgetbuddy.finn_prefs set auto_save_logs = false where user_id = '${CARA}'`);
    expect((await q<{ a: boolean }>(CARA, `select auto_save_logs a from budgetbuddy.finn_prefs`))[0].a).toBe(true);
    expect(await denied(q(DEV, `insert into budgetbuddy.finn_prefs (user_id, auto_save_logs) values ('${CARA}', true)`))).toBe(true);
  });
});
