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
const denied = async (p: Promise<unknown>) => p.then(() => false, () => true);

interface Ctx { space: string; bank: string; cat: string; inc: string }
async function setup(owner = ALICE): Promise<Ctx> {
  return as(owner, async () => {
    const space = (await db.query<{ id: string }>(`select id from budgetbuddy.create_space('S','personal','INR')`)).rows[0].id;
    const bank = (await db.query<{ id: string }>(`insert into budgetbuddy.accounts (space_id,name,type,currency) values ('${space}','Bank','savings','INR') returning id`)).rows[0].id;
    const cat = (await db.query<{ id: string }>(`insert into budgetbuddy.categories (space_id,name,kind) values ('${space}','Uncategorised','expense') returning id`)).rows[0].id;
    const inc = (await db.query<{ id: string }>(`insert into budgetbuddy.categories (space_id,name,kind) values ('${space}','Other income','income') returning id`)).rows[0].id;
    return { space, bank, cat, inc };
  });
}

type Row = { line: number; occurred_at: string; description: string; amount: number; fingerprint: string; category_id: string; include: boolean };
const job = (c: Ctx, rows: Row[], uid = ALICE) =>
  as(uid, async () =>
    (await db.query<{ id: string }>(
      `insert into budgetbuddy.import_jobs (space_id,account_id,filename,rows,created_by) values ('${c.space}','${c.bank}','s.csv','${JSON.stringify(rows).replace(/'/g, "''")}'::jsonb,'${uid}') returning id`,
    )).rows[0].id,
  );
const commit = (id: string, uid = ALICE) => as(uid, async () => (await db.query<{ r: Record<string, number> }>(`select budgetbuddy.commit_import('${id}') r`)).rows[0].r);
const balance = (uid: string, acct: string) =>
  as(uid, async () => Number((await db.query<{ b: string }>(`select coalesce(sum(ledger_balance),0) b from budgetbuddy.account_balances where account_id='${acct}'`)).rows[0].b));
const count = (uid: string, space: string) => as(uid, async () => (await db.query(`select 1 from budgetbuddy.transactions where space_id='${space}'`)).rows.length);

const rows = (c: Ctx): Row[] => [
  { line: 2, occurred_at: "2026-11-01T06:30:00Z", description: "Fresh Basket", amount: -184250, fingerprint: "f1", category_id: c.cat, include: true },
  { line: 3, occurred_at: "2026-11-02T06:30:00Z", description: "Salary Acme", amount: 6500000, fingerprint: "f2", category_id: c.inc, include: true },
  { line: 4, occurred_at: "2026-11-03T06:30:00Z", description: "Maybe duplicate", amount: -5000, fingerprint: "f3", category_id: c.cat, include: false },
];

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

describe("commit_import", () => {
  it("posts only the included rows, as income or expense by sign, and updates the balance", async () => {
    const c = await setup();
    const res = await commit(await job(c, rows(c)));
    expect(res).toMatchObject({ imported: 2, skipped_already_imported: 0, excluded: 1 });
    expect(await balance(ALICE, c.bank)).toBe(6500000 - 184250);
    const t = await as(ALICE, async () => (await db.query<{ type: string; source: string }>(`select type, source from budgetbuddy.transactions where space_id='${c.space}' order by occurred_at`)).rows);
    expect(t).toEqual([{ type: "expense", source: "import" }, { type: "income", source: "import" }]);
  });

  it("importing the same file again creates nothing new (idempotent)", async () => {
    const c = await setup();
    await commit(await job(c, rows(c)));
    const before = await count(ALICE, c.space);
    const again = await commit(await job(c, rows(c)));
    expect(again).toMatchObject({ imported: 0, skipped_already_imported: 2 });
    expect(await count(ALICE, c.space)).toBe(before);
    expect(await balance(ALICE, c.bank)).toBe(6500000 - 184250);
  });

  it("two genuine identical purchases with different fingerprints both import", async () => {
    const c = await setup();
    const same = (n: number): Row => ({ line: n, occurred_at: "2026-11-01T06:30:00Z", description: "Cafe", amount: -25000, fingerprint: `cafe|${n}`, category_id: c.cat, include: true });
    const res = await commit(await job(c, [same(0), same(1)]));
    expect(res.imported).toBe(2);
    expect(await balance(ALICE, c.bank)).toBe(-50000);
  });

  it("a job can be committed only once", async () => {
    const c = await setup();
    const id = await job(c, rows(c));
    await commit(id);
    expect(await denied(commit(id))).toBe(true);
  });

  it("a row with a category from another space is rejected and nothing partial is left", async () => {
    const a = await setup(ALICE);
    const b = await setup(BOB);
    const bad: Row[] = [{ line: 2, occurred_at: "2026-11-01T06:30:00Z", description: "x", amount: -100, fingerprint: "z1", category_id: b.cat, include: true }];
    expect(await denied(commit(await job(a, bad)))).toBe(true);
    expect(await count(ALICE, a.space)).toBe(0);
  });

  it("viewers and non-members cannot create or commit imports", async () => {
    const c = await setup();
    await db.exec(`insert into budgetbuddy.financial_space_members values ('${c.space}','${BOB}','viewer')`);
    expect(await denied(job(c, rows(c), BOB))).toBe(true);
    const id = await job(c, rows(c));
    expect(await denied(commit(id, BOB))).toBe(true);
    expect(await as(BOB, async () => (await db.query(`select 1 from budgetbuddy.import_jobs`)).rows.length)).toBe(0); // statements are hidden from viewers
  });

  it("a job cannot point at another space's account", async () => {
    const a = await setup(ALICE);
    const b = await setup(BOB);
    const bad = as(ALICE, () => db.exec(`insert into budgetbuddy.import_jobs (space_id,account_id,filename,rows,created_by) values ('${a.space}','${b.bank}','s.csv','[]','${ALICE}')`));
    expect(await denied(bad)).toBe(true);
  });
});
