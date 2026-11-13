import { readdirSync, readFileSync } from "node:fs";
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
const denied = async (p: Promise<unknown>, reason?: RegExp) =>
  p.then(
    () => false,
    (e: Error) => (reason ? reason.test(e.message) : true),
  );
const q = <T extends Record<string, unknown>>(uid: string, sql: string) => as(uid, async () => (await db.query<T>(sql)).rows);

interface Ctx { space: string; bank: string; card: string; rentCat: string; salaryCat: string }
async function setup(owner = ALICE): Promise<Ctx> {
  return as(owner, async () => {
    const space = (await db.query<{ id: string }>(`select id from budgetbuddy.create_space('S','personal','INR')`)).rows[0].id;
    const acct = async (n: string, t: string) => (await db.query<{ id: string }>(`insert into budgetbuddy.accounts (space_id,name,type,currency) values ('${space}','${n}','${t}','INR') returning id`)).rows[0].id;
    const cat = async (n: string, k: string) => (await db.query<{ id: string }>(`insert into budgetbuddy.categories (space_id,name,kind) values ('${space}','${n}','${k}') returning id`)).rows[0].id;
    return { space, bank: await acct("Bank", "savings"), card: await acct("Card", "credit_card"), rentCat: await cat("Rent", "expense"), salaryCat: await cat("Salary", "income") };
  });
}
const balance = (uid: string, acct: string) => q<{ b: string }>(uid, `select coalesce(sum(ledger_balance),0) b from budgetbuddy.account_balances where account_id='${acct}'`).then((r) => Number(r[0].b));
const item = (c: Ctx, kind: string, amount: number, extra = "") =>
  as(ALICE, async () =>
    (await db.query<{ id: string }>(
      `insert into budgetbuddy.recurring_items (space_id,kind,name,amount,currency,frequency,first_due,account_id,category_id,created_by ${extra ? "," + extra.split("|")[0] : ""})
       values ('${c.space}','${kind}','Item',${amount},'INR','monthly','2026-11-01','${c.bank}','${kind === "income" ? c.salaryCat : c.rentCat}','${ALICE}' ${extra ? "," + extra.split("|")[1] : ""}) returning id`,
    )).rows[0].id,
  );
const settle = (uid: string, id: string, due = "2026-11-01") =>
  as(uid, async () => (await db.query<{ t: string }>(`select budgetbuddy.settle_recurring_item('${id}','${due}','2026-11-02', '2026-11-02T06:30:00Z') t`)).rows[0].t);

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

describe("expected income and bills settle through the ledger", () => {
  it("expected income changes no balance until it is marked received", async () => {
    const c = await setup();
    const id = await item(c, "income", 5_000_000);
    expect(await balance(ALICE, c.bank)).toBe(0); // scheduled, not received
    await settle(ALICE, id);
    expect(await balance(ALICE, c.bank)).toBe(5_000_000);
    const t = await q<{ type: string; status: string }>(ALICE, `select type,status from budgetbuddy.transactions where space_id='${c.space}'`);
    expect(t).toEqual([{ type: "income", status: "posted" }]);
  });

  it("paying a bill posts an expense from the chosen account", async () => {
    const c = await setup();
    const id = await item(c, "bill", 1_200_000);
    await settle(ALICE, id);
    expect(await balance(ALICE, c.bank)).toBe(-1_200_000);
    const t = await q<{ type: string; merchant: string }>(ALICE, `select type, merchant from budgetbuddy.transactions where space_id='${c.space}'`);
    expect(t[0]).toEqual({ type: "expense", merchant: "Item" });
  });

  it("a due date can be settled only once (no double payment)", async () => {
    const c = await setup();
    const id = await item(c, "bill", 100_000);
    await settle(ALICE, id);
    expect(await denied(settle(ALICE, id))).toBe(true);
    expect(await balance(ALICE, c.bank)).toBe(-100_000);
    await settle(ALICE, id, "2026-12-01"); // the next month is a different due date
    expect(await balance(ALICE, c.bank)).toBe(-200_000);
  });

  it("rejects due dates outside the schedule and inactive items", async () => {
    const c = await setup();
    const id = await item(c, "bill", 100_000);
    expect(await denied(settle(ALICE, id, "2026-10-01"))).toBe(true); // before first_due
    await as(ALICE, () => db.exec(`update budgetbuddy.recurring_items set status='paused' where id='${id}'`));
    expect(await denied(settle(ALICE, id))).toBe(true);
  });

  it("an item without an account and category cannot be settled", async () => {
    const c = await setup();
    const id = await as(ALICE, async () => (await db.query<{ id: string }>(
      `insert into budgetbuddy.recurring_items (space_id,kind,name,amount,currency,frequency,first_due,created_by) values ('${c.space}','bill','Loose',100,'INR','monthly','2026-11-01','${ALICE}') returning id`)).rows[0].id);
    expect(await denied(settle(ALICE, id))).toBe(true);
  });

  it("a viewer or a non-member cannot settle", async () => {
    const c = await setup();
    const id = await item(c, "bill", 100_000);
    await db.exec(`insert into budgetbuddy.financial_space_members values ('${c.space}','${BOB}','viewer')`);
    expect(await denied(settle(BOB, id))).toBe(true);
    await db.exec(`delete from budgetbuddy.financial_space_members where user_id='${BOB}' and space_id='${c.space}'`);
    expect(await denied(settle(BOB, id))).toBe(true);
    expect(await balance(ALICE, c.bank)).toBe(0);
  });

  it("an item cannot point at another space's account or a wrong-kind category", async () => {
    const a = await setup(ALICE);
    const b = await setup(BOB);
    const bad = as(ALICE, () => db.exec(`insert into budgetbuddy.recurring_items (space_id,kind,name,amount,currency,frequency,first_due,account_id,created_by) values ('${a.space}','bill','x',100,'INR','monthly','2026-11-01','${b.bank}','${ALICE}')`));
    expect(await denied(bad, /does not belong to this space/)).toBe(true);
    const wrongKind = as(ALICE, () => db.exec(`insert into budgetbuddy.recurring_items (space_id,kind,name,amount,currency,frequency,first_due,category_id,created_by) values ('${a.space}','bill','x',100,'INR','monthly','2026-11-01','${a.salaryCat}','${ALICE}')`));
    expect(await denied(wrongKind, /matching category/)).toBe(true); // an income category on a bill
    // and the right kind is accepted, proving the rule rejects only the wrong one
    await expect(
      as(ALICE, () => db.exec(`insert into budgetbuddy.recurring_items (space_id,kind,name,amount,currency,frequency,first_due,category_id,created_by) values ('${a.space}','bill','ok',100,'INR','monthly','2026-11-01','${a.rentCat}','${ALICE}')`)),
    ).resolves.toBeDefined();
  });

  it("recurring items and payments are invisible to other spaces' users", async () => {
    const a = await setup(ALICE);
    const id = await item(a, "bill", 100_000);
    await settle(ALICE, id);
    expect(await q(BOB, `select 1 from budgetbuddy.recurring_items`)).toHaveLength(0);
    expect(await q(BOB, `select 1 from budgetbuddy.recurring_payments`)).toHaveLength(0);
  });
});

describe("savings goals", () => {
  it("contributions never touch the ledger or any balance", async () => {
    const c = await setup();
    const goal = await as(ALICE, async () => (await db.query<{ id: string }>(
      `insert into budgetbuddy.savings_goals (space_id,name,target_amount,currency,created_by) values ('${c.space}','Trip',100000,'INR','${ALICE}') returning id`)).rows[0].id);
    await as(ALICE, () => db.exec(`insert into budgetbuddy.goal_contributions (goal_id,space_id,amount,contributed_on,created_by) values ('${goal}','${c.space}',25000,'2026-11-05','${ALICE}')`));
    expect(await q(ALICE, `select 1 from budgetbuddy.transactions where space_id='${c.space}'`)).toHaveLength(0);
    expect(await balance(ALICE, c.bank)).toBe(0);
    const sum = await q<{ s: string }>(ALICE, `select sum(amount) s from budgetbuddy.goal_contributions where goal_id='${goal}'`);
    expect(Number(sum[0].s)).toBe(25000);
  });

  it("a contribution cannot reference a goal from another space", async () => {
    const a = await setup(ALICE);
    const b = await setup(BOB);
    const goalB = await as(BOB, async () => (await db.query<{ id: string }>(
      `insert into budgetbuddy.savings_goals (space_id,name,target_amount,currency,created_by) values ('${b.space}','B',100,'INR','${BOB}') returning id`)).rows[0].id);
    const bad = as(ALICE, () => db.exec(`insert into budgetbuddy.goal_contributions (goal_id,space_id,amount,contributed_on,created_by) values ('${goalB}','${a.space}',50,'2026-11-05','${ALICE}')`));
    expect(await denied(bad)).toBe(true);
  });

  it("viewers read but cannot write goals", async () => {
    const c = await setup();
    await db.exec(`insert into budgetbuddy.financial_space_members values ('${c.space}','${BOB}','viewer')`);
    expect(await denied(as(BOB, () => db.exec(`insert into budgetbuddy.savings_goals (space_id,name,target_amount,currency,created_by) values ('${c.space}','x',100,'INR','${BOB}')`)))).toBe(true);
  });
});

describe("debt terms", () => {
  it("apply only to liability accounts in the same space", async () => {
    const c = await setup();
    await as(ALICE, () => db.exec(`insert into budgetbuddy.debt_terms (account_id,space_id,interest_rate_bps,min_payment) values ('${c.card}','${c.space}',3600,5000)`));
    expect(await denied(as(ALICE, () => db.exec(`insert into budgetbuddy.debt_terms (account_id,space_id,interest_rate_bps,min_payment) values ('${c.bank}','${c.space}',500,0)`)))).toBe(true);
    const other = await setup(BOB);
    expect(await denied(as(ALICE, () => db.exec(`insert into budgetbuddy.debt_terms (account_id,space_id,interest_rate_bps,min_payment) values ('${other.card}','${c.space}',500,0)`)))).toBe(true);
  });
  it("reject an out-of-range rate", async () => {
    const c = await setup();
    expect(await denied(as(ALICE, () => db.exec(`insert into budgetbuddy.debt_terms (account_id,space_id,interest_rate_bps,min_payment) values ('${c.card}','${c.space}',-5,0)`)))).toBe(true);
  });
});
