import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { api, USER } from "./helpers";

const URL_ = process.env.E2E_SUPABASE_URL!;
const KEY = process.env.E2E_SUPABASE_KEY!; // publishable (anon) key only
const TABLES = ["profiles", "financial_spaces", "financial_space_members", "accounts", "categories", "transactions", "ledger_entries", "budgets", "budget_allocations", "account_balances"];
const RANDOM = "00000000-0000-4000-8000-00000000dead";

const anon = () => createClient(URL_, KEY, { auth: { persistSession: false }, db: { schema: "budgetbuddy" } });

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("anonymous access to the live database is denied", () => {
  for (const t of TABLES) {
    test(`${t}: anon reads nothing`, async () => {
      const { data, error } = await anon().from(t).select("*").limit(5);
      // Either RLS returns no rows, or the grant is absent and the request errors. Never rows.
      expect(data ?? []).toEqual([]);
      if (error) expect(error.code).toMatch(/42501|PGRST/);
    });
  }

  test("anon cannot insert a space, transaction or member", async () => {
    const sb = anon();
    for (const [t, row] of [
      ["financial_spaces", { name: "anon space", currency: "USD" }],
      ["transactions", { space_id: RANDOM, type: "expense", occurred_on: "2026-01-01" }],
      ["financial_space_members", { space_id: RANDOM, user_id: RANDOM, role: "owner" }],
    ] as const) {
      const { error } = await sb.from(t).insert(row as never);
      expect(error, `insert into ${t}`).not.toBeNull();
    }
  });

  test("anon cannot call the money-moving or admin functions", async () => {
    const sb = anon();
    for (const [fn, args] of [
      ["post_transaction", { p_space_id: RANDOM }],
      ["reverse_transaction", { p_transaction_id: RANDOM }],
      ["create_space", { p_name: "x", p_currency: "USD" }],
      ["commit_import", { p_job_id: RANDOM }],
      ["settle_recurring_item", { p_item_id: RANDOM }],
    ] as const) {
      const { error } = await sb.rpc(fn, args as never);
      expect(error, `rpc ${fn}`).not.toBeNull();
    }
  });
});

test.describe("a signed-in user cannot reach other people's data", () => {
  test("unknown or foreign space ids return nothing and cannot be written to", async () => {
    const sb = await api();
    for (const t of ["accounts", "transactions", "budgets", "categories", "ledger_entries"]) {
      const { data } = await sb.from(t).select("*").eq("space_id", RANDOM).limit(5);
      expect(data ?? [], t).toEqual([]);
    }
    const ins = await sb.from("accounts").insert({ space_id: RANDOM, name: "intruder", type: "checking", currency: "USD" } as never);
    expect(ins.error, "cannot add an account to a space that is not yours").not.toBeNull();
    const post = await sb.rpc("post_transaction", { p_space_id: RANDOM } as never);
    expect(post.error).not.toBeNull();
  });

  test("the user sees only spaces they are a member of", async () => {
    const sb = await api();
    const { data: me } = await sb.auth.getUser();
    const { data: spaces } = await sb.from("financial_spaces").select("id");
    const { data: mem } = await sb.from("financial_space_members").select("space_id,user_id").eq("user_id", me.user!.id);
    const mine = new Set((mem ?? []).map((m) => m.space_id));
    expect((spaces ?? []).length).toBeGreaterThan(0);
    for (const s of spaces ?? []) expect(mine.has(s.id)).toBe(true);
  });

  test("another member row cannot be read or forged from the client", async () => {
    const sb = await api();
    const { data: me } = await sb.auth.getUser();
    const { data } = await sb.from("financial_space_members").select("user_id");
    for (const m of data ?? []) expect(m.user_id).toBe(me.user!.id);
    const forged = await sb.from("financial_space_members").insert({ space_id: RANDOM, user_id: me.user!.id, role: "owner" } as never);
    expect(forged.error).not.toBeNull();
  });

  test("HireCheck's public schema is not exposed through Budget Buddy's session or key", async () => {
    // Budget Buddy never needs the other app's data; the disposable user must not see other users' profiles.
    const sb = createClient(URL_, KEY, { auth: { persistSession: false } });
    await sb.auth.signInWithPassword(USER);
    const { data } = await sb.from("profiles").select("id");
    const { data: me } = await sb.auth.getUser();
    for (const r of data ?? []) expect(r.id).toBe(me.user!.id);
  });
});

test.describe("storage and secrets", () => {
  test("anon cannot list or read private buckets", async () => {
    const sb = createClient(URL_, KEY, { auth: { persistSession: false } });
    const { data } = await sb.storage.listBuckets();
    for (const b of data ?? []) expect(b.public, `bucket ${b.name}`).toBe(false);
    const r = await sb.storage.from("budgetbuddy-imports").list("", { limit: 5 });
    expect(r.data ?? []).toEqual([]);
  });

  test("no service-role key, JWT secret or server-only variable is shipped to the browser", async () => {
    const dir = ".next/static";
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(js|css|html|json)$/.test(f)) files.push(p);
      }
    };
    walk(dir);
    expect(files.length).toBeGreaterThan(0);
    const forbidden = [/service_role/i, /SUPABASE_SERVICE/i, /RECOVERY_COOKIE_SECRET/, /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]*c2VydmljZV9yb2xl/];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const re of forbidden) expect(re.test(text), `${f} matches ${re}`).toBe(false);
    }
  });

  test("responses do not leak server secrets or stack traces", async ({ request }) => {
    for (const p of ["/", "/login", "/contact", "/nope-not-a-page"]) {
      const body = await (await request.get(p)).text();
      expect(body).not.toMatch(/service_role|SUPABASE_SERVICE|RECOVERY_COOKIE_SECRET|at \S+ \(.*\.(js|ts):\d+/);
    }
  });

  test("security headers are set on pages", async ({ request }) => {
    const r = await request.get("/");
    const h = r.headers();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"] ?? h["content-security-policy"]).toBeTruthy();
  });
});

test.describe("integrity: the ledger cannot be corrupted from the client", () => {
  test("a client cannot post an unbalanced transaction", async () => {
    const sb = await api();
    const { data: spaces } = await sb.from("financial_spaces").select("id").limit(1);
    const space = spaces![0].id;
    const { data: accts } = await sb.from("accounts").select("id").eq("space_id", space).limit(1);
    const { data: tx, error } = await sb.from("transactions").insert({ space_id: space, type: "expense", occurred_on: "2026-01-01", status: "posted", description: "unbalanced" } as never).select("id").single();
    if (error) return; // header insert refused outright: also safe
    const bad = await sb.from("ledger_entries").insert({ transaction_id: tx!.id, space_id: space, account_id: accts![0].id, amount_minor: 100, currency: "USD" } as never);
    // Whether the entry insert or the deferred balance check refuses it, the header must not survive as posted.
    const { data: left } = await sb.from("transactions").select("id").eq("id", tx!.id);
    expect(bad.error !== null || (left ?? []).length === 0).toBe(true);
  });
});
