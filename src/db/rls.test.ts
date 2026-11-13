/**
 * Runs the real migration SQL in an in-process Postgres (PGlite) with minimal
 * stand-ins for Supabase's auth.users, auth.uid() and API roles, then verifies
 * ledger integrity and Row Level Security. This does not touch any remote DB.
 *
 * Limitation: PGlite is a single-connection Postgres; this proves the policies
 * and constraints, not Supabase's PostgREST/JWT layer. Re-run against a
 * Supabase branch before launch.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const ALICE = "00000000-0000-0000-0000-00000000000a";
const BOB = "00000000-0000-0000-0000-00000000000b";
const EVE = "00000000-0000-0000-0000-00000000000e";

let db: PGlite;

async function as<T>(uid: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

async function denied(p: Promise<unknown>): Promise<boolean> {
  try {
    await p;
    return false;
  } catch {
    return true;
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    insert into auth.users values ('${ALICE}'), ('${BOB}'), ('${EVE}');
  `);
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261113000001_budgetbuddy_core.sql"), "utf8");
  await db.exec(sql);
});

async function setup() {
  // Alice owns a space with a bank account and a food category; Bob is a viewer; Eve is outside.
  const space = await as(ALICE, async () =>
    (await db.query<{ id: string }>(`select id from budgetbuddy.create_space('Alice', 'personal', 'INR')`)).rows[0].id,
  );
  await db.exec(`insert into budgetbuddy.financial_space_members values ('${space}', '${BOB}', 'viewer')`);
  const acct = await as(ALICE, async () =>
    (await db.query<{ id: string }>(
      `insert into budgetbuddy.accounts (space_id, name, type, currency) values ('${space}','Bank','savings','INR') returning id`,
    )).rows[0].id,
  );
  const cat = await as(ALICE, async () =>
    (await db.query<{ id: string }>(
      `insert into budgetbuddy.categories (space_id, name, kind) values ('${space}','Food','expense') returning id`,
    )).rows[0].id,
  );
  return { space, acct, cat };
}

async function postExpense(uid: string, s: { space: string; acct: string; cat: string }, amount: number, extId?: string) {
  return as(uid, async () => {
    const t = await db.query<{ id: string }>(
      `insert into budgetbuddy.transactions (space_id,type,occurred_at,currency,amount,created_by,source,external_id)
       values ('${s.space}','expense', now(),'INR',${amount},'${uid}','import',${extId ? `'${extId}'` : "null"}) returning id`,
    );
    const id = t.rows[0].id;
    await db.exec(`
      begin;
      insert into budgetbuddy.ledger_entries (transaction_id,space_id,account_id,amount) values ('${id}','${s.space}','${s.acct}',-${amount});
      insert into budgetbuddy.ledger_entries (transaction_id,space_id,category_id,amount) values ('${id}','${s.space}','${s.cat}',${amount});
      commit;`);
    return id;
  });
}

describe("ledger integrity (database level)", () => {
  it("accepts a balanced posting", async () => {
    const s = await setup();
    await expect(postExpense(ALICE, s, 5000)).resolves.toBeTruthy();
  });

  it("rejects an unbalanced posting at commit", async () => {
    const s = await setup();
    const bad = as(ALICE, async () => {
      const t = await db.query<{ id: string }>(
        `insert into budgetbuddy.transactions (space_id,type,occurred_at,currency,amount,created_by)
         values ('${s.space}','expense',now(),'INR',100,'${ALICE}') returning id`,
      );
      await db.exec(`
        begin;
        insert into budgetbuddy.ledger_entries (transaction_id,space_id,account_id,amount) values ('${t.rows[0].id}','${s.space}','${s.acct}',-100);
        commit;`);
    });
    expect(await denied(bad)).toBe(true);
    await db.exec("rollback").catch(() => undefined);
  });

  it("makes imports idempotent: same external id cannot be inserted twice", async () => {
    const s = await setup();
    await postExpense(ALICE, s, 700, "bank-ref-1");
    expect(await denied(postExpense(ALICE, s, 700, "bank-ref-1"))).toBe(true);
    await db.exec("rollback").catch(() => undefined);
  });

  it("blocks deleting or rewriting posted transactions", async () => {
    const s = await setup();
    const id = await postExpense(ALICE, s, 900);
    expect(await denied(as(ALICE, () => db.exec(`delete from budgetbuddy.transactions where id='${id}'`)))).toBe(true);
    expect(await denied(as(ALICE, () => db.exec(`update budgetbuddy.transactions set amount=1 where id='${id}'`)))).toBe(true);
  });
});

describe("row level security", () => {
  it("a non-member cannot read another user's space, accounts or transactions", async () => {
    const s = await setup();
    await postExpense(ALICE, s, 1234);
    const counts = await as(EVE, async () => ({
      spaces: (await db.query(`select 1 from budgetbuddy.financial_spaces where id='${s.space}'`)).rows.length,
      accounts: (await db.query(`select 1 from budgetbuddy.accounts where space_id='${s.space}'`)).rows.length,
      txns: (await db.query(`select 1 from budgetbuddy.transactions where space_id='${s.space}'`)).rows.length,
      entries: (await db.query(`select 1 from budgetbuddy.ledger_entries where space_id='${s.space}'`)).rows.length,
    }));
    expect(counts).toEqual({ spaces: 0, accounts: 0, txns: 0, entries: 0 });
  });

  it("a non-member cannot write into someone else's space by guessing its UUID", async () => {
    const s = await setup();
    const attempt = as(EVE, () =>
      db.exec(`insert into budgetbuddy.transactions (space_id,type,occurred_at,currency,amount,created_by)
               values ('${s.space}','expense',now(),'INR',100,'${EVE}')`),
    );
    expect(await denied(attempt)).toBe(true);
  });

  it("a viewer can read but not write", async () => {
    const s = await setup();
    await postExpense(ALICE, s, 4321);
    const rows = await as(BOB, async () => (await db.query(`select 1 from budgetbuddy.transactions where space_id='${s.space}'`)).rows.length);
    expect(rows).toBe(1);
    expect(await denied(postExpense(BOB, s, 100))).toBe(true);
    await db.exec("rollback").catch(() => undefined);
  });

  it("a viewer cannot promote themselves or add members", async () => {
    const s = await setup();
    expect(await denied(as(BOB, () => db.exec(`update budgetbuddy.financial_space_members set role='owner' where user_id='${BOB}' and space_id='${s.space}'`)))).toBe(false); // RLS filters to 0 rows, no error
    const role = (await db.query<{ role: string }>(`select role from budgetbuddy.financial_space_members where user_id='${BOB}' and space_id='${s.space}'`)).rows[0].role;
    expect(role).toBe("viewer");
    expect(await denied(as(BOB, () => db.exec(`insert into budgetbuddy.financial_space_members values ('${s.space}','${EVE}','viewer')`)))).toBe(true);
  });

  it("an admin cannot mint an owner", async () => {
    const s = await setup();
    await db.exec(`update budgetbuddy.financial_space_members set role='admin' where user_id='${BOB}' and space_id='${s.space}'`);
    expect(await denied(as(BOB, () => db.exec(`insert into budgetbuddy.financial_space_members values ('${s.space}','${EVE}','owner')`)))).toBe(true);
  });

  it("an entry cannot reference a different space than its transaction", async () => {
    const a = await setup();
    const b = await setup(); // a second Alice space
    const t = await as(ALICE, async () =>
      (await db.query<{ id: string }>(
        `insert into budgetbuddy.transactions (space_id,type,occurred_at,currency,amount,created_by)
         values ('${a.space}','expense',now(),'INR',100,'${ALICE}') returning id`,
      )).rows[0].id,
    );
    const attempt = as(ALICE, () =>
      db.exec(`insert into budgetbuddy.ledger_entries (transaction_id,space_id,account_id,amount) values ('${t}','${b.space}','${b.acct}',-100)`),
    );
    expect(await denied(attempt)).toBe(true);
  });

  it("a private account is hidden from other space members", async () => {
    const s = await setup();
    await db.exec(`update budgetbuddy.financial_space_members set role='editor' where user_id='${BOB}' and space_id='${s.space}'`);
    await as(BOB, () =>
      db.exec(`insert into budgetbuddy.accounts (space_id, owner_user_id, name, type, currency)
               values ('${s.space}','${BOB}','Bob private','savings','INR')`),
    );
    const names = async (uid: string) =>
      as(uid, async () => (await db.query<{ name: string }>(`select name from budgetbuddy.accounts where space_id='${s.space}'`)).rows.map((r) => r.name));
    expect(await names(ALICE)).not.toContain("Bob private");
    expect(await names(BOB)).toContain("Bob private");
  });

  it("a user sees only their own profile", async () => {
    await as(ALICE, () => db.query(`select * from budgetbuddy.ensure_profile()`));
    await as(BOB, () => db.query(`select * from budgetbuddy.ensure_profile()`));
    const seen = await as(ALICE, async () => (await db.query<{ user_id: string }>(`select user_id from budgetbuddy.profiles`)).rows);
    expect(seen.map((r) => r.user_id)).toEqual([ALICE]);
  });

  it("anonymous callers get no access at all", async () => {
    await db.exec(`set role anon`);
    const blocked = await denied(db.exec(`select * from budgetbuddy.transactions`));
    await db.exec(`reset role`);
    expect(blocked).toBe(true);
  });

  it("clients cannot write the audit log", async () => {
    const s = await setup();
    expect(await denied(as(ALICE, () => db.exec(`insert into budgetbuddy.audit_logs (space_id, action, entity) values ('${s.space}','x','y')`)))).toBe(true);
  });
});
