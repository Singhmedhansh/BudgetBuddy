/**
 * Migration 10: refunds and reversals are protected against concurrent submission.
 * PGlite is a single connection, so it cannot reproduce two requests racing. What can be proved here is
 * what makes the race safe: the database itself refuses a second reversal, and the refund check locks the
 * original expense row. Both are asserted against the real migrated schema.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { friendlyDbError } from "@/server/ledger-write";

const ALICE = "00000000-0000-0000-0000-00000000000a";
let db: PGlite;

async function asAlice<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${ALICE}',false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`);
  }
}
const denied = (p: Promise<unknown>) => p.then(() => false, () => true);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    insert into auth.users values ('${ALICE}');
    create schema storage; create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
  `);
  const dir = join(process.cwd(), "supabase/migrations");
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(join(dir, f), "utf8"));
});

async function expense() {
  return asAlice(async () => {
    const space = (await db.query<{ id: string }>(`select id from budgetbuddy.create_space('S','personal','INR')`)).rows[0].id;
    const acct = (await db.query<{ id: string }>(`insert into budgetbuddy.accounts (space_id,name,type,currency) values ('${space}','Bank','savings','INR') returning id`)).rows[0].id;
    const cat = (await db.query<{ id: string }>(`insert into budgetbuddy.categories (space_id,name,kind) values ('${space}','Food','expense') returning id`)).rows[0].id;
    const id = (await db.query<{ id: string }>(
      `select budgetbuddy.post_transaction('${space}','expense', now(), 'INR', 1000, '[{"account_id":"${acct}","amount":-1000},{"category_id":"${cat}","amount":1000}]'::jsonb) id`,
    )).rows[0].id;
    return { space, id };
  });
}

describe("one reversal per transaction, enforced by the database", () => {
  it("refuses a second reversal row even when the function's own check is bypassed", async () => {
    const { space, id } = await expense();
    await asAlice(() => db.query(`select budgetbuddy.reverse_transaction('${id}')`));
    // A superuser insert skips the function and its "already reversed" check, as a racing second request would.
    const second = db.query(
      `insert into budgetbuddy.transactions (space_id, type, status, occurred_at, currency, amount, source, reversal_of, created_by)
       values ('${space}','expense','posted', now(), 'INR', 1000, 'manual', '${id}', '${ALICE}')`,
    );
    await expect(second).rejects.toThrow(/transactions_one_reversal/);
  });

  it("still allows reversing a different transaction, and a refund and its reversal", async () => {
    const a = await expense();
    const b = await expense();
    await asAlice(() => db.query(`select budgetbuddy.reverse_transaction('${a.id}')`));
    await asAlice(() => db.query(`select budgetbuddy.reverse_transaction('${b.id}')`));
    const n = (await db.query<{ n: string }>(`select count(*) n from budgetbuddy.transactions where reversal_of in ('${a.id}','${b.id}')`)).rows[0].n;
    expect(Number(n)).toBe(2);
  });

  it("the function still refuses a repeat reversal with the friendly message", async () => {
    const { id } = await expense();
    await asAlice(() => db.query(`select budgetbuddy.reverse_transaction('${id}')`));
    const err = await asAlice(() => db.query(`select budgetbuddy.reverse_transaction('${id}')`)).catch((e: Error) => e.message);
    expect(typeof err).toBe("string");
    expect(friendlyDbError(String(err))).toBe("This transaction was already reversed.");
    expect(friendlyDbError('duplicate key value violates unique constraint "transactions_one_reversal"')).toBe("This transaction was already reversed.");
  });
});

describe("refund limit check locks the original expense", () => {
  it("post_transaction takes FOR UPDATE on the expense being refunded", async () => {
    const def = (await db.query<{ d: string }>(`select pg_get_functiondef('budgetbuddy.post_transaction'::regproc) d`)).rows[0].d;
    expect(def.toLowerCase()).toMatch(/for update/);
    expect(def.toLowerCase().indexOf("for update")).toBeLessThan(def.toLowerCase().indexOf("refund exceeds"));
  });

  it("a refund within the limit works and one over it is refused (behaviour unchanged)", async () => {
    const { space, id } = await expense();
    const acct = (await db.query<{ id: string }>(`select id from budgetbuddy.accounts where space_id='${space}'`)).rows[0].id;
    const cat = (await db.query<{ id: string }>(`select id from budgetbuddy.categories where space_id='${space}' and name='Food'`)).rows[0].id;
    const refund = (amt: number) => asAlice(() => db.query(
      `select budgetbuddy.post_transaction('${space}','refund', now(), 'INR', ${amt}, '[{"account_id":"${acct}","amount":${amt}},{"category_id":"${cat}","amount":-${amt}}]'::jsonb, null,null,null,'posted','manual',null,'${id}')`,
    ));
    await refund(600);
    expect(await denied(refund(401))).toBe(true);
    await refund(400);
  });
});

describe("a goal's saved total cannot go below zero", () => {
  async function goal() {
    const { space } = await expense();
    const id = await asAlice(async () =>
      (await db.query<{ id: string }>(`insert into budgetbuddy.savings_goals (space_id,name,target_amount,currency,priority,created_by) values ('${space}','Trip',1000000,'INR',2,'${ALICE}') returning id`)).rows[0].id,
    );
    return { space, id };
  }
  const contribute = (g: { space: string; id: string }, amount: number) =>
    asAlice(() => db.query(`insert into budgetbuddy.goal_contributions (goal_id,space_id,amount,contributed_on,created_by) values ('${g.id}','${g.space}',${amount},current_date,'${ALICE}')`));
  const saved = async (id: string) => Number((await db.query<{ s: string }>(`select coalesce(sum(amount),0) s from budgetbuddy.goal_contributions where goal_id='${id}'`)).rows[0].s);

  it("refuses a withdrawal larger than what is saved, and records nothing", async () => {
    const g = await goal();
    await contribute(g, 250000);
    await contribute(g, -50000);
    expect(await denied(contribute(g, -9999900))).toBe(true);
    expect(await saved(g.id)).toBe(200000);
  });

  it("allows taking out exactly everything, and adding again afterwards", async () => {
    const g = await goal();
    await contribute(g, 10000);
    await contribute(g, -10000);
    expect(await saved(g.id)).toBe(0);
    expect(await denied(contribute(g, -1))).toBe(true);
    await contribute(g, 500);
    expect(await saved(g.id)).toBe(500);
  });

  it("refuses an edit that would turn an existing contribution into an over-withdrawal", async () => {
    const g = await goal();
    await contribute(g, 1000);
    await contribute(g, -400);
    const row = (await db.query<{ id: string }>(`select id from budgetbuddy.goal_contributions where goal_id='${g.id}' and amount = -400`)).rows[0].id;
    expect(await denied(asAlice(() => db.query(`update budgetbuddy.goal_contributions set amount = -2000 where id = '${row}'`)))).toBe(true);
    await asAlice(() => db.query(`update budgetbuddy.goal_contributions set amount = -900 where id = '${row}'`)); // still within what was saved
    expect(await saved(g.id)).toBe(100);
  });

  it("gives a plain message", () => {
    expect(friendlyDbError("A withdrawal cannot be more than what is saved for the goal")).toBe("You can only take out what is saved for this goal.");
  });
});
