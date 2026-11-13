/**
 * Shared spaces, role enforcement and ledger-integrity hardening (migration 8).
 * Several tests here document holes found by the functional audit: they fail on
 * migrations 1-7 and pass with migration 8.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const U = (n: number) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const [OWNER, ADMIN, EDITOR, VIEWER, OUTSIDER] = [U(1), U(2), U(3), U(4), U(5)];
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

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    insert into auth.users values ${[OWNER, ADMIN, EDITOR, VIEWER, OUTSIDER].map((u) => `('${u}')`).join(",")};
    create schema storage; create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
  `);
  const dir = join(process.cwd(), "supabase/migrations");
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(join(dir, f), "utf8"));
});

interface World { space: string; bank: string; cash: string; food: string; salary: string }
async function world(): Promise<World> {
  const space = (await q<{ id: string }>(OWNER, `select id from budgetbuddy.create_space('Home','household','INR')`))[0].id;
  // Direct membership inserts are exactly what the schema must NOT allow clients to do, so test setup uses the superuser.
  await db.exec(`insert into budgetbuddy.financial_space_members values
    ('${space}','${ADMIN}','admin'),('${space}','${EDITOR}','editor'),('${space}','${VIEWER}','viewer')`);
  const one = async (sql: string) => (await q<{ id: string }>(OWNER, sql))[0].id;
  return {
    space,
    bank: await one(`insert into budgetbuddy.accounts (space_id,name,type,currency) values ('${space}','Bank','savings','INR') returning id`),
    cash: await one(`insert into budgetbuddy.accounts (space_id,name,type,currency) values ('${space}','Cash','cash','INR') returning id`),
    food: await one(`insert into budgetbuddy.categories (space_id,name,kind) values ('${space}','Food','expense') returning id`),
    salary: await one(`insert into budgetbuddy.categories (space_id,name,kind) values ('${space}','Pay','income') returning id`),
  };
}
const post = (w: World, uid: string, type: string, amount: number, entries: unknown[], extra = "") =>
  q<{ id: string }>(uid, `select budgetbuddy.post_transaction('${w.space}','${type}', now(), 'INR', ${amount}, '${JSON.stringify(entries)}'::jsonb ${extra}) as id`).then((r) => r[0].id);
const bal = async (uid: string, acct: string) => Number((await q<{ b: string }>(uid, `select coalesce(sum(ledger_balance),0) b from budgetbuddy.account_balances where account_id='${acct}'`))[0].b);

describe("membership cannot be rewritten by clients (audit finding)", () => {
  it("an admin cannot remove or demote the owner, or add arbitrary users", async () => {
    const w = await world();
    expect(await denied(q(ADMIN, `delete from budgetbuddy.financial_space_members where space_id='${w.space}' and user_id='${OWNER}'`).then(async () => {
      const left = await q(OWNER, `select 1 from budgetbuddy.financial_space_members where space_id='${w.space}' and user_id='${OWNER}'`);
      if (left.length === 0) throw new Error("owner membership was deleted");
    }))).toBe(true);
    await q(ADMIN, `update budgetbuddy.financial_space_members set role='viewer' where space_id='${w.space}' and user_id='${OWNER}'`).catch(() => {});
    expect((await q<{ role: string }>(OWNER, `select role from budgetbuddy.financial_space_members where space_id='${w.space}' and user_id='${OWNER}'`))[0]?.role).toBe("owner");
    expect(await denied(q(ADMIN, `insert into budgetbuddy.financial_space_members values ('${w.space}','${OUTSIDER}','editor')`))).toBe(true);
  });
});

describe("posted history is immutable (audit finding)", () => {
  it("an editor cannot hide a posted transaction by changing its status", async () => {
    const w = await world();
    const id = await post(w, EDITOR, "income", 50000, [{ account_id: w.bank, amount: 50000 }, { category_id: w.salary, amount: -50000 }]);
    await q(EDITOR, `update budgetbuddy.transactions set status='pending' where id='${id}'`).catch(() => {});
    expect(await bal(OWNER, w.bank)).toBe(50000);
  });

  it("an editor cannot append entries to an existing posted transaction", async () => {
    const w = await world();
    const id = await post(w, EDITOR, "income", 50000, [{ account_id: w.bank, amount: 50000 }, { category_id: w.salary, amount: -50000 }]);
    const tried = await denied(q(EDITOR, `insert into budgetbuddy.ledger_entries (transaction_id,space_id,account_id,amount) values ('${id}','${w.space}','${w.bank}',-100), ('${id}','${w.space}','${w.cash}',100)`));
    expect(tried).toBe(true);
    expect(await bal(OWNER, w.bank)).toBe(50000);
  });

  it("links and authorship of a posted transaction cannot be rewritten", async () => {
    const w = await world();
    const id = await post(w, EDITOR, "income", 100, [{ account_id: w.bank, amount: 100 }, { category_id: w.salary, amount: -100 }]);
    expect(await denied(q(EDITOR, `update budgetbuddy.transactions set created_by='${OWNER}' where id='${id}'`))).toBe(true);
    // notes-style metadata is still editable
    await q(EDITOR, `update budgetbuddy.transactions set merchant='Acme', description='fixed typo', notes='n' where id='${id}'`);
    expect((await q<{ merchant: string }>(OWNER, `select merchant from budgetbuddy.transactions where id='${id}'`))[0].merchant).toBe("Acme");
  });
});

describe("reversal and refunds interact safely (audit finding)", () => {
  it("an expense with an active refund cannot be reversed until the refund is reversed", async () => {
    const w = await world();
    await post(w, EDITOR, "income", 100000, [{ account_id: w.bank, amount: 100000 }, { category_id: w.salary, amount: -100000 }]);
    const exp = await post(w, EDITOR, "expense", 10000, [{ account_id: w.bank, amount: -10000 }, { category_id: w.food, amount: 10000 }]);
    const refund = await post(w, EDITOR, "refund", 4000, [{ account_id: w.bank, amount: 4000 }, { category_id: w.food, amount: -4000 }], `, null, null, null, 'posted', 'manual', null, '${exp}'`);
    expect(await denied(q(EDITOR, `select budgetbuddy.reverse_transaction('${exp}')`))).toBe(true);
    await q(EDITOR, `select budgetbuddy.reverse_transaction('${refund}')`);
    await q(EDITOR, `select budgetbuddy.reverse_transaction('${exp}')`);
    expect(await bal(OWNER, w.bank)).toBe(100000);
    const spent = await q<{ s: string }>(OWNER, `select coalesce(sum(e.amount),0) s from budgetbuddy.ledger_entries e join budgetbuddy.categories c on c.id=e.category_id where c.id='${w.food}'`);
    expect(Number(spent[0].s)).toBe(0);
  });
});

describe("invitations", () => {
  it("only admins can invite, only owners can invite admins, and the code is single-use", async () => {
    const w = await world();
    expect(await denied(q(EDITOR, `select budgetbuddy.create_invite('${w.space}','viewer')`))).toBe(true);
    expect(await denied(q(ADMIN, `select budgetbuddy.create_invite('${w.space}','admin')`))).toBe(true);
    expect(await denied(q(OWNER, `select budgetbuddy.create_invite('${w.space}','owner')`))).toBe(true);
    const code = (await q<{ c: string }>(ADMIN, `select budgetbuddy.create_invite('${w.space}','editor') c`))[0].c;
    expect(code.length).toBeGreaterThanOrEqual(20);
    const joined = (await q<{ s: string }>(OUTSIDER, `select budgetbuddy.accept_invite('${code}') s`))[0].s;
    expect(joined).toBe(w.space);
    expect((await q<{ role: string }>(OUTSIDER, `select role from budgetbuddy.financial_space_members where space_id='${w.space}' and user_id='${OUTSIDER}'`))[0].role).toBe("editor");
    expect(await denied(q(VIEWER, `select budgetbuddy.accept_invite('${code}')`))).toBe(true); // already used
  });

  it("expired, revoked, unknown and already-a-member invitations are refused with one generic message", async () => {
    const w = await world();
    const mk = async () => (await q<{ c: string }>(OWNER, `select budgetbuddy.create_invite('${w.space}','viewer') c`))[0].c;
    const expired = await mk();
    await db.exec(`update budgetbuddy.space_invites set expires_at = now() - interval '1 minute' where code='${expired}'`);
    const revoked = await mk();
    const id = (await db.query<{ id: string }>(`select id from budgetbuddy.space_invites where code='${revoked}'`)).rows[0].id;
    await q(OWNER, `select budgetbuddy.revoke_invite('${id}')`);
    const msgs: string[] = [];
    for (const code of [expired, revoked, "does-not-exist"]) {
      await as(OUTSIDER, async () => { try { await db.query(`select budgetbuddy.accept_invite('${code}')`); } catch (e) { msgs.push((e as Error).message); } });
    }
    expect(msgs).toHaveLength(3);
    expect(new Set(msgs).size).toBe(1);
    expect(msgs[0]).toMatch(/not valid or has expired/);
    expect(await denied(q(VIEWER, `select budgetbuddy.accept_invite('${await mk()}')`))).toBe(true); // existing member
  });

  it("only admins can read invitation codes", async () => {
    const w = await world();
    await q(OWNER, `select budgetbuddy.create_invite('${w.space}','viewer')`);
    expect((await q(EDITOR, `select * from budgetbuddy.space_invites where space_id='${w.space}'`)).length).toBe(0);
    expect((await q(OUTSIDER, `select * from budgetbuddy.space_invites where space_id='${w.space}'`)).length).toBe(0);
    expect((await q(ADMIN, `select * from budgetbuddy.space_invites where space_id='${w.space}'`)).length).toBe(1);
  });
});

describe("member management", () => {
  it("lists members for members only, without emails", async () => {
    const w = await world();
    const rows = await q<{ user_id: string; role: string }>(VIEWER, `select * from budgetbuddy.list_members('${w.space}')`);
    expect(rows.map((r) => r.role).sort()).toEqual(["admin", "editor", "owner", "viewer"]);
    expect(Object.keys(rows[0])).not.toContain("email");
    expect(await denied(q(OUTSIDER, `select * from budgetbuddy.list_members('${w.space}')`))).toBe(true);
  });

  it("role changes follow the hierarchy and the owner is protected", async () => {
    const w = await world();
    await q(ADMIN, `select budgetbuddy.set_member_role('${w.space}','${VIEWER}','editor')`);
    expect(await denied(q(ADMIN, `select budgetbuddy.set_member_role('${w.space}','${VIEWER}','admin')`))).toBe(true); // only owner makes admins
    expect(await denied(q(ADMIN, `select budgetbuddy.set_member_role('${w.space}','${OWNER}','viewer')`))).toBe(true);
    expect(await denied(q(EDITOR, `select budgetbuddy.set_member_role('${w.space}','${VIEWER}','viewer')`))).toBe(true);
    expect(await denied(q(OWNER, `select budgetbuddy.set_member_role('${w.space}','${OWNER}','viewer')`))).toBe(true); // not yourself
    await q(OWNER, `select budgetbuddy.set_member_role('${w.space}','${ADMIN}','viewer')`);
  });

  it("members can leave, admins can remove others, nobody removes the owner", async () => {
    const w = await world();
    expect(await denied(q(ADMIN, `select budgetbuddy.remove_member('${w.space}','${OWNER}')`))).toBe(true);
    expect(await denied(q(OWNER, `select budgetbuddy.remove_member('${w.space}','${OWNER}')`))).toBe(true);
    expect(await denied(q(EDITOR, `select budgetbuddy.remove_member('${w.space}','${VIEWER}')`))).toBe(true);
    await q(ADMIN, `select budgetbuddy.remove_member('${w.space}','${VIEWER}')`);
    expect(await q(VIEWER, `select * from budgetbuddy.financial_spaces where id='${w.space}'`)).toHaveLength(0);
    await q(EDITOR, `select budgetbuddy.remove_member('${w.space}','${EDITOR}')`); // leave
    expect(await q(EDITOR, `select * from budgetbuddy.financial_spaces where id='${w.space}'`)).toHaveLength(0);
  });
});

describe("role enforcement on financial data", () => {
  it("viewers read but cannot write; editors write; outsiders see nothing", async () => {
    const w = await world();
    const entries = [{ account_id: w.bank, amount: 100 }, { category_id: w.salary, amount: -100 }];
    expect(await denied(post(w, VIEWER, "income", 100, entries))).toBe(true);
    await post(w, EDITOR, "income", 100, entries);
    expect(await bal(VIEWER, w.bank)).toBe(100);
    expect(await bal(OUTSIDER, w.bank)).toBe(0);
    expect(await q(OUTSIDER, `select * from budgetbuddy.transactions where space_id='${w.space}'`)).toHaveLength(0);
    expect(await denied(q(VIEWER, `insert into budgetbuddy.accounts (space_id,name,type,currency) values ('${w.space}','X','cash','INR')`))).toBe(true);
    expect(await denied(q(VIEWER, `insert into budgetbuddy.budgets (space_id,name,period,starts_on,currency,created_by) values ('${w.space}','B','monthly','2026-11-01','INR','${VIEWER}')`))).toBe(true);
  });
});

describe("delete_my_data", () => {
  it("removes a sole-owned space with its ledger, leaves shared spaces and others' data alone", async () => {
    const mine = await q<{ id: string }>(OUTSIDER, `select id from budgetbuddy.create_space('Mine','personal','INR')`);
    const space = mine[0].id;
    const acct = (await q<{ id: string }>(OUTSIDER, `insert into budgetbuddy.accounts (space_id,name,type,currency) values ('${space}','A','cash','INR') returning id`))[0].id;
    const cat = (await q<{ id: string }>(OUTSIDER, `insert into budgetbuddy.categories (space_id,name,kind) values ('${space}','Pay','income') returning id`))[0].id;
    await q(OUTSIDER, `select budgetbuddy.post_transaction('${space}','income',now(),'INR',500,'[{"account_id":"${acct}","amount":500},{"category_id":"${cat}","amount":-500}]'::jsonb)`);
    const other = await world();
    await q(OUTSIDER, `select budgetbuddy.delete_my_data()`);
    expect((await db.query(`select 1 from budgetbuddy.financial_spaces where id='${space}'`)).rows).toHaveLength(0);
    expect((await db.query(`select 1 from budgetbuddy.transactions where space_id='${space}'`)).rows).toHaveLength(0);
    expect((await db.query(`select 1 from budgetbuddy.profiles where user_id='${OUTSIDER}'`)).rows).toHaveLength(0);
    expect((await db.query(`select 1 from budgetbuddy.financial_spaces where id='${other.space}'`)).rows).toHaveLength(1); // another user's space untouched
  });

  it("refuses while the person still owns a space with other members", async () => {
    const w = await world();
    expect(await denied(q(OWNER, `select budgetbuddy.delete_my_data()`))).toBe(true);
    expect((await db.query(`select 1 from budgetbuddy.financial_spaces where id='${w.space}'`)).rows).toHaveLength(1);
  });
});
