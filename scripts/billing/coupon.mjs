// Creates and lists promotion codes (coupons). Run it from the project root:
//
//   node scripts/billing/coupon.mjs create --code INSTA30 --days 30 [--campaign instagram] [--max 500] [--until 2026-12-31]
//                                          [--from 2026-12-01] [--intervals month,year] [--paypal] [--live]
//   node scripts/billing/coupon.mjs list
//   node scripts/billing/coupon.mjs disable --code INSTA30
//
// A code gives a longer free trial (--days). Razorpay needs nothing extra: the first charge date is set per subscription.
// PayPal fixes the trial length inside the plan, so --paypal also creates a PayPal plan with that trial length for each
// billing period and records their ids on the code. Without --paypal the code works for Razorpay only.
//
// Needs (in .env.local or the environment): NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. For --paypal also
// PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET. PayPal calls go to the SANDBOX unless you pass --live, which creates real
// (billable) plans on your live PayPal account: only do that for a code you mean to publish.
import { readFileSync } from "node:fs";

for (const file of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no such file */
  }
}

const [, , command, ...rest] = process.argv;
const flag = (n) => rest.includes(`--${n}`);
const arg = (n) => {
  const i = rest.indexOf(`--${n}`);
  return i >= 0 && rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[i + 1] : undefined;
};
const fail = (m) => {
  console.error(m);
  process.exit(1);
};

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) fail("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (in .env.local or the environment).");
const rest_ = (path, init = {}) =>
  fetch(`${url}/rest/v1/${path}`, { ...init, headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", "accept-profile": "budgetbuddy", "content-profile": "budgetbuddy", ...(init.headers ?? {}) } });

async function createPaypalPlans(days, intervals, live) {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) fail("--paypal needs PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.");
  const base = live ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
  const tj = await (await fetch(`${base}/v1/oauth2/token`, { method: "POST", headers: { authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"), "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" })).json();
  if (!tj.access_token) fail("PayPal sign-in failed. Check the credentials and whether they are for " + (live ? "live" : "sandbox") + ".");
  const call = async (path, body) => {
    const r = await fetch(base + path, { method: "POST", headers: { authorization: `Bearer ${tj.access_token}`, "content-type": "application/json", prefer: "return=representation" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) fail(`PayPal ${path} failed with HTTP ${r.status} ${j.name ?? ""} ${j.message ?? ""}`);
    return j;
  };
  // Prices come from the price list: keep these in step with src/config/plans.ts (checkout reads each plan's own price).
  const price = { month: arg("usd-month") ?? "2.99", year: arg("usd-year") ?? "23.99" };
  const product = process.env.PAYPAL_PRODUCT_ID ? { id: process.env.PAYPAL_PRODUCT_ID } : await call("/v1/catalogs/products", { name: "FinTrack One", type: "SERVICE", category: "SOFTWARE" });
  const ids = {};
  for (const interval of intervals) {
    const plan = await call("/v1/billing/plans", {
      product_id: product.id,
      name: `FinTrack One (${interval}ly, ${days}-day free trial)`,
      status: "ACTIVE",
      billing_cycles: [
        { frequency: { interval_unit: "DAY", interval_count: days }, tenure_type: "TRIAL", sequence: 1, total_cycles: 1, pricing_scheme: { fixed_price: { value: "0", currency_code: "USD" } } },
        { frequency: { interval_unit: interval === "month" ? "MONTH" : "YEAR", interval_count: 1 }, tenure_type: "REGULAR", sequence: 2, total_cycles: 0, pricing_scheme: { fixed_price: { value: price[interval], currency_code: "USD" } } },
      ],
      payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 3 },
    });
    ids[interval] = plan.id;
  }
  return ids;
}

if (command === "create") {
  const code = (arg("code") ?? "").toUpperCase();
  const days = Number(arg("days"));
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) fail("--code must be 3 to 32 letters, digits, - or _ (it is stored in capitals).");
  if (!Number.isInteger(days) || days < 1 || days > 365) fail("--days must be a whole number from 1 to 365.");
  const intervals = (arg("intervals") ?? "month,year").split(",").map((s) => s.trim()).filter(Boolean);
  if (!intervals.every((i) => i === "month" || i === "year")) fail("--intervals must be month, year or month,year.");
  const max = arg("max") ? Number(arg("max")) : null;
  if (max !== null && (!Number.isInteger(max) || max < 1)) fail("--max must be a positive whole number.");
  const date = (n) => {
    const v = arg(n);
    if (!v) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) fail(`--${n} must be a date such as 2026-12-31.`);
    return d.toISOString();
  };
  const paypal = flag("paypal") ? await createPaypalPlans(days, intervals, flag("live")) : {};
  const res = await rest_("billing_coupons", { method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify({ code, campaign: arg("campaign") ?? null, kind: "trial_days", trial_days: days, intervals, paypal_plan_ids: paypal, max_redemptions: max, valid_from: date("from"), valid_until: date("until") }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) fail(`Could not create the code: HTTP ${res.status} ${j.message ?? ""}`);
  console.log(`Created ${code}: ${days} days free, ${intervals.join(" and ")}${max ? `, first ${max} people` : ""}${arg("until") ? `, until ${arg("until")}` : ""}.`);
  console.log(flag("paypal") ? `PayPal plans (${flag("live") ? "live" : "sandbox"}): ${JSON.stringify(paypal)}` : "Razorpay only. Re-create with --paypal to offer it on PayPal too.");
} else if (command === "list") {
  const res = await rest_("billing_coupons?select=code,campaign,trial_days,intervals,redeemed_count,max_redemptions,valid_from,valid_until,active,paypal_plan_ids&order=created_at.desc");
  const rows = await res.json();
  if (!res.ok) fail(`Could not read codes: HTTP ${res.status} ${rows.message ?? ""}`);
  for (const c of rows) console.log(`${c.active ? " on " : " off"}  ${c.code.padEnd(14)} ${String(c.trial_days).padStart(3)} days  used ${c.redeemed_count}${c.max_redemptions ? "/" + c.max_redemptions : ""}  ${c.intervals.join(",")}  ${Object.keys(c.paypal_plan_ids ?? {}).length ? "PayPal" : "Razorpay only"}  ${c.campaign ?? ""}${c.valid_until ? "  until " + c.valid_until.slice(0, 10) : ""}`);
  if (rows.length === 0) console.log("No codes yet.");
} else if (command === "disable") {
  const code = (arg("code") ?? "").toUpperCase();
  if (!code) fail("--code is required.");
  const res = await rest_(`billing_coupons?code=eq.${encodeURIComponent(code)}`, { method: "PATCH", headers: { prefer: "return=representation" }, body: JSON.stringify({ active: false }) });
  const rows = await res.json().catch(() => []);
  console.log(res.ok && rows.length ? `${code} is switched off. Subscriptions already started with it are not affected.` : `No code ${code} found.`);
} else {
  console.log("Usage: node scripts/billing/coupon.mjs create --code INSTA30 --days 30 [--campaign instagram] [--max 500] [--until 2026-12-31] [--from 2026-12-01] [--intervals month,year] [--paypal] [--live]\n       node scripts/billing/coupon.mjs list\n       node scripts/billing/coupon.mjs disable --code INSTA30");
}
