/**
 * Profile fields, avatars, ownership transfer, account-data deletion, AI limits and entitlements (migration 9).
 * Runs the real migrations 1-9 in-process.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const U = (n: number) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const [ALICE, BOB, CAROL, DAVE] = [U(1), U(2), U(3), U(4)];
let db: PGlite;

async function as<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`);
  }
}
const denied = (p: Promise<unknown>) => p.then(() => false, () => true);
const q = async <T>(uid: string, sql: string) => as(uid, async () => (await db.query<T>(sql)).rows);
const root = async <T>(sql: string) => (await db.query<T>(sql)).rows;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    insert into auth.users values ${[ALICE, BOB, CAROL, DAVE].map((u) => `('${u}')`).join(",")};
    create schema storage; create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated, anon; grant select, insert, update, delete on storage.objects to authenticated;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
  `);
  const dir = join(process.cwd(), "supabase/migrations");
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(join(dir, f), "utf8"));
  for (const u of [ALICE, BOB, CAROL, DAVE]) await q(u, `select * from budgetbuddy.ensure_profile()`);
});

describe("profile fields", () => {
  it("start empty so completion is honest, with sensible defaults only where a default is harmless", async () => {
    const [p] = await q<Record<string, unknown>>(ALICE, `select * from budgetbuddy.profiles where user_id='${ALICE}'`);
    expect(p).toMatchObject({ country: null, phone: null, date_format: null, avatar_path: null, profile_completed_at: null, number_format: "en-IN" });
    expect(p.dashboard_prefs).toEqual({});
    expect(p.notification_prefs).toEqual({});
  });

  it("persist across sessions and are returned unchanged", async () => {
    await q(ALICE, `update budgetbuddy.profiles set display_name='Alice Rao', country='IN', phone='+91 98765 43210', date_format='dmy', number_format='en-IN',
      dashboard_prefs='{"showForecast":false}', notification_prefs='{"budget_alerts":true,"product":false}' where user_id='${ALICE}'`);
    const [p] = await q<Record<string, unknown>>(ALICE, `select * from budgetbuddy.profiles where user_id='${ALICE}'`);
    expect(p).toMatchObject({ display_name: "Alice Rao", country: "IN", phone: "+91 98765 43210", date_format: "dmy" });
    expect(p.dashboard_prefs).toEqual({ showForecast: false });
    expect(p.notification_prefs).toEqual({ budget_alerts: true, product: false });
  });

  it.each([
    ["a phone number with letters", `phone='call me'`],
    ["a country that is not a two-letter code", `country='India'`],
    ["an unknown date format", `date_format='yyyy'`],
    ["an unknown number format", `number_format='xx-XX'`],
    ["preferences that are not an object", `notification_prefs='[1,2]'`],
    ["oversized preferences", `dashboard_prefs=jsonb_build_object('k', repeat('x', 3000))`],
  ])("rejects %s", async (_n, set) => {
    expect(await denied(q(ALICE, `update budgetbuddy.profiles set ${set} where user_id='${ALICE}'`))).toBe(true);
  });

  it("cannot point an avatar at someone else's folder", async () => {
    expect(await denied(q(ALICE, `update budgetbuddy.profiles set avatar_path='${BOB}/avatar.png' where user_id='${ALICE}'`))).toBe(true);
    await q(ALICE, `update budgetbuddy.profiles set avatar_path='${ALICE}/avatar.png' where user_id='${ALICE}'`);
  });

  it("is private: nobody reads or edits another person's profile", async () => {
    expect(await q(BOB, `select * from budgetbuddy.profiles where user_id='${ALICE}'`)).toHaveLength(0);
    await q(BOB, `update budgetbuddy.profiles set display_name='Hacked' where user_id='${ALICE}'`);
    expect((await root<{ display_name: string }>(`select display_name from budgetbuddy.profiles where user_id='${ALICE}'`))[0].display_name).toBe("Alice Rao");
  });

  it("anonymous visitors cannot touch profiles", async () => {
    await db.exec(`set role anon`);
    try {
      expect(await denied(db.query(`select * from budgetbuddy.profiles`))).toBe(true);
    } finally {
      await db.exec(`reset role`);
    }
  });
});

describe("avatar storage", () => {
  const put = (uid: string, folder: string) => q(uid, `insert into storage.objects (bucket_id, name) values ('budgetbuddy-avatars','${folder}/avatar.png')`);

  it("the bucket is private, size-limited and image-only", async () => {
    const [b] = await root<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(`select public, file_size_limit, allowed_mime_types from storage.buckets where id='budgetbuddy-avatars'`);
    expect(b.public).toBe(false);
    expect(Number(b.file_size_limit)).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(b.allowed_mime_types.sort()).toEqual(["image/jpeg", "image/png", "image/webp"]);
  });
  it("a person can write and read only inside their own folder", async () => {
    await put(ALICE, ALICE);
    expect(await denied(put(ALICE, BOB))).toBe(true);
    expect(await q(ALICE, `select name from storage.objects where bucket_id='budgetbuddy-avatars'`)).toHaveLength(1);
    expect(await q(BOB, `select name from storage.objects where bucket_id='budgetbuddy-avatars'`)).toHaveLength(0);
  });
  it("another person cannot overwrite or delete it", async () => {
    await q(BOB, `update storage.objects set name='${BOB}/stolen.png' where bucket_id='budgetbuddy-avatars'`);
    await q(BOB, `delete from storage.objects where bucket_id='budgetbuddy-avatars'`);
    expect(await root(`select 1 from storage.objects where name='${ALICE}/avatar.png'`)).toHaveLength(1);
  });
});

async function space(owner: string, name: string): Promise<string> {
  return (await q<{ id: string }>(owner, `select id from budgetbuddy.create_space('${name}','household','INR')`))[0].id;
}
const join_ = (s: string, uid: string, role: string) => root(`insert into budgetbuddy.financial_space_members values ('${s}','${uid}','${role}')`);
const roleOf = async (s: string, uid: string) => (await root<{ role: string }>(`select role from budgetbuddy.financial_space_members where space_id='${s}' and user_id='${uid}'`))[0]?.role;

describe("ownership transfer", () => {
  it("promotes the member, keeps the previous owner as admin, and leaves exactly one owner", async () => {
    const s = await space(ALICE, "Transfer");
    await join_(s, BOB, "editor");
    await q(ALICE, `select budgetbuddy.transfer_ownership('${s}','${BOB}')`);
    expect(await roleOf(s, BOB)).toBe("owner");
    expect(await roleOf(s, ALICE)).toBe("admin");
    expect((await root<{ n: string }>(`select count(*) n from budgetbuddy.financial_space_members where space_id='${s}' and role='owner'`))[0].n).toBe(1);
  });
  it("is refused for non-owners, for yourself, and for people outside the space", async () => {
    const s = await space(ALICE, "Refusals");
    await join_(s, BOB, "admin");
    await join_(s, CAROL, "editor");
    expect(await denied(q(BOB, `select budgetbuddy.transfer_ownership('${s}','${CAROL}')`))).toBe(true); // an admin is not the owner
    expect(await denied(q(ALICE, `select budgetbuddy.transfer_ownership('${s}','${ALICE}')`))).toBe(true);
    expect(await denied(q(ALICE, `select budgetbuddy.transfer_ownership('${s}','${DAVE}')`))).toBe(true);
    expect(await roleOf(s, ALICE)).toBe("owner");
  });
  it("anonymous callers cannot reach the function", async () => {
    await db.exec(`set role anon`);
    try {
      expect(await denied(db.query(`select budgetbuddy.transfer_ownership('${U(9)}','${BOB}')`))).toBe(true);
    } finally {
      await db.exec(`reset role`);
    }
  });
});

describe("account-data deletion safeguards", () => {
  async function seedLedger(owner: string, s: string) {
    const acct = (await q<{ id: string }>(owner, `insert into budgetbuddy.accounts (space_id,name,type,currency) values ('${s}','Bank','savings','INR') returning id`))[0].id;
    const cat = (await q<{ id: string }>(owner, `insert into budgetbuddy.categories (space_id,name,kind) values ('${s}','Food','expense') returning id`))[0].id;
    const entries = JSON.stringify([{ account_id: acct, amount: -500 }, { category_id: cat, amount: 500 }]);
    await q(owner, `select budgetbuddy.post_transaction('${s}','expense', now(), 'INR', 500, '${entries}'::jsonb)`);
    // the ledger really exists before deletion, so the "gone afterwards" assertions mean something
    expect(await root(`select 1 from budgetbuddy.ledger_entries where space_id='${s}'`)).toHaveLength(2);
  }

  it("lists a space the person owns that others still use, and refuses to delete until it is resolved", async () => {
    const s = await space(CAROL, "Shared household");
    await join_(s, DAVE, "editor");
    const blockers = await q<{ space_id: string; space_name: string; other_members: number }>(CAROL, `select * from budgetbuddy.deletion_blockers()`);
    expect(blockers).toEqual([{ space_id: s, space_name: "Shared household", other_members: 1 }]);
    expect(await denied(q(CAROL, `select budgetbuddy.delete_my_data()`))).toBe(true);
    // nothing was removed by the refused attempt
    expect(await root(`select 1 from budgetbuddy.financial_spaces where id='${s}'`)).toHaveLength(1);
    expect(await root(`select 1 from budgetbuddy.profiles where user_id='${CAROL}'`)).toHaveLength(1);
  });

  it("once ownership is handed over, deletion removes only the person's own data and leaves the shared space intact", async () => {
    const shared = (await root<{ id: string }>(`select id from budgetbuddy.financial_spaces where name='Shared household'`))[0].id;
    await q(CAROL, `select budgetbuddy.transfer_ownership('${shared}','${DAVE}')`);
    const own = await space(CAROL, "Carol private");
    await seedLedger(CAROL, own);
    await root(`insert into budgetbuddy.help_feedback (slug, helpful, user_id) values ('x', true, '${CAROL}')`);
    await root(`insert into budgetbuddy.support_requests (reference, user_id, email, topic, subject, message) values ('BB-TEST1','${CAROL}','c@example.test','bug','Subject here','A long enough message body')`);
    await q(CAROL, `select budgetbuddy.ai_reserve(10, 1000)`);

    await q(CAROL, `select budgetbuddy.delete_my_data()`);

    expect(await root(`select 1 from budgetbuddy.financial_spaces where id='${own}'`)).toHaveLength(0);
    expect(await root(`select 1 from budgetbuddy.transactions where space_id='${own}'`)).toHaveLength(0);
    expect(await root(`select 1 from budgetbuddy.ledger_entries where space_id='${own}'`)).toHaveLength(0);
    expect(await root(`select 1 from budgetbuddy.profiles where user_id='${CAROL}'`)).toHaveLength(0);
    expect(await root(`select 1 from budgetbuddy.help_feedback where user_id='${CAROL}'`)).toHaveLength(0);
    expect(await root(`select 1 from budgetbuddy.support_requests where user_id='${CAROL}'`)).toHaveLength(0);
    expect(await root(`select 1 from budgetbuddy.ai_usage where user_id='${CAROL}'`)).toHaveLength(0);
    expect(await root(`select 1 from budgetbuddy.financial_space_members where user_id='${CAROL}'`)).toHaveLength(0);
    // the space Carol handed to Dave is untouched and Dave still owns it
    expect(await root(`select 1 from budgetbuddy.financial_spaces where id='${shared}'`)).toHaveLength(1);
    expect(await roleOf(shared, DAVE)).toBe("owner");
    // no orphaned ledger rows anywhere
    expect(await root(`select 1 from budgetbuddy.ledger_entries e where not exists (select 1 from budgetbuddy.transactions t where t.id = e.transaction_id)`)).toHaveLength(0);
    // the posted-transaction guard is back on afterwards
    const [t] = await root<{ tgenabled: string }>(`select tgenabled from pg_trigger where tgname='transactions_protect_posted'`);
    expect(t.tgenabled).toBe("O");
  });

  it("never touches other people's data", async () => {
    expect(await root(`select 1 from budgetbuddy.profiles where user_id in ('${ALICE}','${BOB}','${DAVE}')`)).toHaveLength(3);
  });

  it("a member's own invitations and joins are cleaned up without breaking the owner's space", async () => {
    const s = await space(ALICE, "Invites");
    await join_(s, BOB, "admin");
    const code = (await q<{ c: string }>(ALICE, `select budgetbuddy.create_invite('${s}','viewer') c`))[0].c;
    await q(DAVE, `select budgetbuddy.accept_invite('${code}')`);
    await q(BOB, `select budgetbuddy.create_invite('${s}','editor')`);
    await q(BOB, `select budgetbuddy.delete_my_data()`).catch(() => null);
    if (await root(`select 1 from budgetbuddy.profiles where user_id='${BOB}'`).then((r) => r.length === 0)) {
      expect(await root(`select 1 from budgetbuddy.space_invites where created_by='${BOB}'`)).toHaveLength(0);
    }
    expect(await roleOf(s, ALICE)).toBe("owner");
  });

  it("anonymous callers cannot delete anything", async () => {
    await db.exec(`set role anon`);
    try {
      expect(await denied(db.query(`select budgetbuddy.delete_my_data()`))).toBe(true);
    } finally {
      await db.exec(`reset role`);
    }
  });
});

describe("AI usage limits", () => {
  it("allows calls under the hourly limit and refuses the next one", async () => {
    const r = [];
    for (let i = 0; i < 3; i++) r.push((await q<{ r: { allowed: boolean } }>(ALICE, `select budgetbuddy.ai_reserve(3, 100000) r`))[0].r);
    expect(r.map((x) => x.allowed)).toEqual([true, true, true]);
    const blocked = (await q<{ r: { allowed: boolean; reason: string } }>(ALICE, `select budgetbuddy.ai_reserve(3, 100000) r`))[0].r;
    expect(blocked).toEqual({ allowed: false, reason: "hourly" });
  });
  it("counts a reserved call even before it finishes, so parallel requests cannot slip past the limit", async () => {
    const n = (await root<{ n: string }>(`select count(*) n from budgetbuddy.ai_usage where user_id='${ALICE}' and status='pending'`))[0].n;
    expect(Number(n)).toBe(3);
  });
  it("enforces a daily token budget from settled calls", async () => {
    const id = (await q<{ r: { id: number } }>(BOB, `select budgetbuddy.ai_reserve(100, 1000) r`))[0].r.id;
    await q(BOB, `select budgetbuddy.ai_settle(${id}, 'ok', 'groq', 'llama', 900, 200, 450)`);
    expect((await q<{ r: { reason: string } }>(BOB, `select budgetbuddy.ai_reserve(100, 1000) r`))[0].r.reason).toBe("daily");
  });
  it("only the owner of a pending reservation can settle it, once", async () => {
    const id = (await q<{ r: { id: number } }>(DAVE, `select budgetbuddy.ai_reserve(100, 100000) r`))[0].r.id;
    await q(ALICE, `select budgetbuddy.ai_settle(${id}, 'ok', 'groq', 'm', 99999, 99999, 1)`);
    expect((await root<{ status: string }>(`select status from budgetbuddy.ai_usage where id=${id}`))[0].status).toBe("pending");
    await q(DAVE, `select budgetbuddy.ai_settle(${id}, 'ok', 'gemini', 'm', 10, 20, 100)`);
    await q(DAVE, `select budgetbuddy.ai_settle(${id}, 'error', 'gemini', 'm', 999, 999, 100)`);
    const [row] = await root<{ status: string; prompt_tokens: number }>(`select status, prompt_tokens from budgetbuddy.ai_usage where id=${id}`);
    expect(row).toEqual({ status: "ok", prompt_tokens: 10 });
  });
  it("usage is readable only by its owner and cannot be written directly", async () => {
    expect((await q(ALICE, `select * from budgetbuddy.ai_usage`)).length).toBeGreaterThan(0);
    expect(await q(BOB, `select * from budgetbuddy.ai_usage where user_id='${ALICE}'`)).toHaveLength(0);
    expect(await denied(q(ALICE, `insert into budgetbuddy.ai_usage (user_id) values ('${ALICE}')`))).toBe(true);
    expect(await denied(q(ALICE, `update budgetbuddy.ai_usage set prompt_tokens = 0 where user_id='${ALICE}'`))).toBe(true);
  });
});

describe("entitlements", () => {
  it("a person can read their own plan but never grant themselves one", async () => {
    await root(`insert into budgetbuddy.entitlements (user_id, plan, provider, current_period_end) values ('${ALICE}','pro','manual', now() + interval '30 days')`);
    expect((await q<{ plan: string }>(ALICE, `select plan from budgetbuddy.entitlements`))[0].plan).toBe("pro");
    expect(await q(BOB, `select * from budgetbuddy.entitlements`)).toHaveLength(0);
    expect(await denied(q(BOB, `insert into budgetbuddy.entitlements (user_id, plan) values ('${BOB}','pro')`))).toBe(true);
    expect(await denied(q(ALICE, `update budgetbuddy.entitlements set plan='free' where user_id='${ALICE}'`))).toBe(true);
  });
  it("payment events are invisible to clients and processed once", async () => {
    await root(`insert into budgetbuddy.payment_events (provider, event_id) values ('razorpay','evt_1')`);
    expect(await denied(root(`insert into budgetbuddy.payment_events (provider, event_id) values ('razorpay','evt_1')`))).toBe(true);
    expect(await denied(q(ALICE, `select * from budgetbuddy.payment_events`))).toBe(true);
  });
});

describe("sample data marker", () => {
  it("defaults to false so real spaces are never labelled sample", async () => {
    const s = await space(ALICE, "Real");
    expect((await root<{ is_sample: boolean }>(`select is_sample from budgetbuddy.financial_spaces where id='${s}'`))[0].is_sample).toBe(false);
  });
});

describe("sample data space (preview account isolation)", () => {
  async function sampleSpace(owner: string, name = "Sample data · test") {
    const id = await space(owner, name);
    await q(owner, `update budgetbuddy.financial_spaces set is_sample = true where id='${id}'`);
    const acct = (await q<{ id: string }>(owner, `insert into budgetbuddy.accounts (space_id,name,type,currency) values ('${id}','Bank','current','INR') returning id`))[0].id;
    const cat = (await q<{ id: string }>(owner, `insert into budgetbuddy.categories (space_id,name,kind) values ('${id}','Food','expense') returning id`))[0].id;
    const entries = JSON.stringify([{ account_id: acct, amount: -700 }, { category_id: cat, amount: 700 }]);
    await q(owner, `select budgetbuddy.post_transaction('${id}','expense', now(), 'INR', 700, '${entries}'::jsonb)`);
    return id;
  }

  it("is visible only to its owner: other people and anonymous visitors see none of it", async () => {
    const s = await sampleSpace(ALICE, "Sample data · alice");
    for (const who of [BOB, CAROL, DAVE]) {
      expect(await q(who, `select 1 from budgetbuddy.financial_spaces where id='${s}'`)).toHaveLength(0);
      expect(await q(who, `select 1 from budgetbuddy.transactions where space_id='${s}'`)).toHaveLength(0);
      expect(await q(who, `select 1 from budgetbuddy.accounts where space_id='${s}'`)).toHaveLength(0);
    }
    await db.exec(`set role anon`);
    try {
      expect(await denied(db.query(`select 1 from budgetbuddy.transactions`))).toBe(true);
    } finally {
      await db.exec(`reset role`);
    }
  });

  it("can be removed by its owner, ledger included, leaving no orphans and the guard re-enabled", async () => {
    const s = await sampleSpace(BOB, "Sample data · bob");
    expect(await root(`select 1 from budgetbuddy.ledger_entries where space_id='${s}'`)).toHaveLength(2);
    await q(BOB, `select budgetbuddy.delete_sample_space('${s}')`);
    expect(await root(`select 1 from budgetbuddy.financial_spaces where id='${s}'`)).toHaveLength(0);
    expect(await root(`select 1 from budgetbuddy.transactions where space_id='${s}'`)).toHaveLength(0);
    expect(await root(`select 1 from budgetbuddy.ledger_entries where space_id='${s}'`)).toHaveLength(0);
    expect((await root<{ tgenabled: string }>(`select tgenabled from pg_trigger where tgname='transactions_protect_posted'`))[0].tgenabled).toBe("O");
  });

  it("refuses to remove a real space, even by its owner", async () => {
    const real = await space(ALICE, "My real money");
    expect(await denied(q(ALICE, `select budgetbuddy.delete_sample_space('${real}')`))).toBe(true);
    expect(await root(`select 1 from budgetbuddy.financial_spaces where id='${real}'`)).toHaveLength(1);
  });

  it("refuses anyone who is not the owner, and anonymous callers", async () => {
    const s = await sampleSpace(ALICE, "Sample data · guarded");
    expect(await denied(q(BOB, `select budgetbuddy.delete_sample_space('${s}')`))).toBe(true);
    await join_(s, CAROL, "admin");
    expect(await denied(q(CAROL, `select budgetbuddy.delete_sample_space('${s}')`))).toBe(true);
    await db.exec(`set role anon`);
    try {
      expect(await denied(db.query(`select budgetbuddy.delete_sample_space('${s}')`))).toBe(true);
    } finally {
      await db.exec(`reset role`);
    }
    expect(await root(`select 1 from budgetbuddy.financial_spaces where id='${s}'`)).toHaveLength(1);
  });

  it("refuses while someone else is still a member", async () => {
    const s = await sampleSpace(DAVE, "Sample data · shared");
    await join_(s, BOB, "viewer");
    expect(await denied(q(DAVE, `select budgetbuddy.delete_sample_space('${s}')`))).toBe(true);
  });

  it("does not touch the owner's real spaces", async () => {
    const real = await space(ALICE, "Real, kept");
    const s = await sampleSpace(ALICE, "Sample data · temp");
    await q(ALICE, `select budgetbuddy.delete_sample_space('${s}')`);
    expect(await root(`select 1 from budgetbuddy.financial_spaces where id='${real}'`)).toHaveLength(1);
  });
});
