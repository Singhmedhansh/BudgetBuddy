/**
 * Tests for migration 4: cross-space smuggling is blocked, post_transaction is
 * atomic, refunds are capped, reversals offset without rewriting history, and
 * balances come from the ledger. Runs in-process (PGlite); the same checks are
 * re-run against the live project after applying the migration.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const ALICE = "00000000-0000-0000-0000-00000000000a";
const BOB = "00000000-0000-0000-0000-00000000000b";
let db: PGlite;

async function as<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`);
  }
}
const denied = async (p: Promise<unknown>) => p.then(() => false, () => true);

interface Ctx { space: string; bank: string; cash: string; food: string; salary: string; opening: string }
async function setup(owner = ALICE): Promise<Ctx> {
  return as(owner, async () => {
    const space = (await db.query<{ id: string }>(`select id from budgetbuddy.create_space('S','personal','INR')`)).rows[0].id;
    const acct = async (n: string, type: string) =>
      (await db.query<{ id: string }>(`insert into budgetbuddy.accounts (space_id,name,type,currency) values ('${space}','${n}','${type}','INR') returning id`)).rows[0].id;
    const cat = async (n: string, kind: string) =>
      (await db.query<{ id: string }>(`insert into budgetbuddy.categories (space_id,name,kind) values ('${space}','${n}','${kind}') returning id`)).rows[0].id;
    const opening = (await db.query<{ id: string }>(`select id from budgetbuddy.categories where space_id='${space}' and name='Opening balance'`)).rows[0].id;
    return { space, bank: await acct("Bank", "savings"), cash: await acct("Cash", "cash"), food: await cat("Food", "expense"), salary: await cat("Salary", "income"), opening };
  });
}
const post = (c: Ctx, type: string, amount: number, entries: unknown[], extra = "", uid = ALICE) =>
  as(uid, async () =>
    (await db.query<{ id: string }>(
      `select budgetbuddy.post_transaction('${c.space}','${type}', now(), 'INR', ${amount}, '${JSON.stringify(entries)}'::jsonb ${extra}) as id`,
    )).rows[0].id,
  );
const balance = (uid: string, acct: string) =>
  as(uid, async () => Number((await db.query<{ b: string }>(`select coalesce(sum(ledger_balance),0) b from budgetbuddy.account_balances where account_id='${acct}'`)).rows[0].b));

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    insert into auth.users values ('${ALICE}'),('${BOB}');
    create schema storage; create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
  `);
  const dir = join(process.cwd(), "supabase/migrations");
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(join(dir, f), "utf8"));
});

describe("create_space", () => {
  it("seeds opening-balance and adjustment equity categories", async () => {
    const c = await setup();
    const names = await as(ALICE, async () => (await db.query<{ name: string }>(`select name from budgetbuddy.categories where space_id='${c.space}' and kind='equity' order by name`)).rows.map((r) => r.name));
    expect(names).toEqual(["Balance adjustment", "Opening balance"]);
  });
});

describe("post_transaction", () => {
  it("posts header and entries atomically and updates balances", async () => {
    const c = await setup();
    await post(c, "income", 100000, [{ account_id: c.bank, amount: 100000 }, { category_id: c.salary, amount: -100000 }]);
    await post(c, "expense", 25000, [{ account_id: c.bank, amount: -25000 }, { category_id: c.food, amount: 25000 }]);
    expect(await balance(ALICE, c.bank)).toBe(75000);
  });

  it("rejects an unbalanced call and leaves nothing behind", async () => {
    const c = await setup();
    const before = (await db.query<{ n: string }>(`select count(*) n from budgetbuddy.transactions where space_id='${c.space}'`)).rows[0].n;
    // force the deferred check inside the same transaction, as a real request's commit would
    const bad = as(ALICE, async () => {
      await db.exec("begin");
      try {
        await db.query(`select budgetbuddy.post_transaction('${c.space}','expense', now(),'INR',100,'[{"account_id":"${c.bank}","amount":-100}]'::jsonb)`);
        await db.exec("set constraints all immediate");
        await db.exec("commit");
      } catch (e) {
        await db.exec("rollback");
        throw e;
      }
    });
    expect(await denied(bad)).toBe(true);
    const after = (await db.query<{ n: string }>(`select count(*) n from budgetbuddy.transactions where space_id='${c.space}'`)).rows[0].n;
    expect(after).toBe(before);
  });

  it("transfers move money between accounts without touching income or expense", async () => {
    const c = await setup();
    await post(c, "adjustment", 50000, [{ account_id: c.bank, amount: 50000 }, { category_id: c.opening, amount: -50000 }]);
    await post(c, "transfer", 20000, [{ account_id: c.bank, amount: -20000 }, { account_id: c.cash, amount: 20000 }]);
    expect(await balance(ALICE, c.bank)).toBe(30000);
    expect(await balance(ALICE, c.cash)).toBe(20000);
  });

  it("a viewer cannot post", async () => {
    const c = await setup();
    await db.exec(`insert into budgetbuddy.financial_space_members values ('${c.space}','${BOB}','viewer')`);
    expect(await denied(post(c, "expense", 1, [{ account_id: c.bank, amount: -1 }, { category_id: c.food, amount: 1 }], "", BOB))).toBe(true);
  });
});

describe("cross-space smuggling", () => {
  it("an editor cannot post entries against another space's account or category", async () => {
    const a = await setup(ALICE);
    const b = await setup(BOB); // Bob's own, separate space
    // Alice knows Bob's account uuid (worst case) and tries to touch it from her own space
    const attempt = post(a, "expense", 500, [{ account_id: b.bank, amount: -500 }, { category_id: a.food, amount: 500 }]);
    expect(await denied(attempt)).toBe(true);
    const attempt2 = post(a, "expense", 500, [{ account_id: a.bank, amount: -500 }, { category_id: b.food, amount: 500 }]);
    expect(await denied(attempt2)).toBe(true);
    expect(await balance(BOB, b.bank)).toBe(0);
  });
});

describe("refunds", () => {
  it("links to the original expense and cannot exceed it", async () => {
    const c = await setup();
    const exp = await post(c, "expense", 10000, [{ account_id: c.bank, amount: -10000 }, { category_id: c.food, amount: 10000 }]);
    const refund = (amt: number) => post(c, "refund", amt, [{ account_id: c.bank, amount: amt }, { category_id: c.food, amount: -amt }], `, p_refund_of => '${exp}'`);
    await refund(4000);
    expect(await denied(refund(6001))).toBe(true);
    await refund(6000);
    expect(await balance(ALICE, c.bank)).toBe(0);
  });
  it("a refund of someone else's or a non-expense transaction is refused", async () => {
    const c = await setup();
    const inc = await post(c, "income", 5000, [{ account_id: c.bank, amount: 5000 }, { category_id: c.salary, amount: -5000 }]);
    expect(await denied(post(c, "refund", 100, [{ account_id: c.bank, amount: 100 }, { category_id: c.food, amount: -100 }], `, p_refund_of => '${inc}'`))).toBe(true);
  });
});

describe("reverse_transaction", () => {
  it("offsets the original, keeps both rows, and cannot be reversed twice", async () => {
    const c = await setup();
    const exp = await post(c, "expense", 7000, [{ account_id: c.bank, amount: -7000 }, { category_id: c.food, amount: 7000 }]);
    const rev = await as(ALICE, async () => (await db.query<{ id: string }>(`select budgetbuddy.reverse_transaction('${exp}') id`)).rows[0].id);
    expect(rev).toBeTruthy();
    expect(await balance(ALICE, c.bank)).toBe(0);
    const rows = await as(ALICE, async () => (await db.query(`select 1 from budgetbuddy.transactions where space_id='${c.space}'`)).rows.length);
    expect(rows).toBe(2);
    expect(await denied(as(ALICE, () => db.query(`select budgetbuddy.reverse_transaction('${exp}')`)))).toBe(true);
    expect(await denied(as(ALICE, () => db.query(`select budgetbuddy.reverse_transaction('${rev}')`)))).toBe(true);
  });
  it("a non-member cannot reverse", async () => {
    const c = await setup();
    const exp = await post(c, "expense", 100, [{ account_id: c.bank, amount: -100 }, { category_id: c.food, amount: 100 }]);
    expect(await denied(as(BOB, () => db.query(`select budgetbuddy.reverse_transaction('${exp}')`)))).toBe(true);
  });
});

describe("account_balances view", () => {
  it("only exposes accounts the caller may see", async () => {
    const a = await setup(ALICE);
    await post(a, "income", 900, [{ account_id: a.bank, amount: 900 }, { category_id: a.salary, amount: -900 }]);
    expect(await balance(BOB, a.bank)).toBe(0);
    expect(await balance(ALICE, a.bank)).toBe(900);
  });
});
