// Creates the recurring plans the checkout needs, in SANDBOX only, and prints the ids to put in the environment.
//
//   node scripts/billing/create-plans.mjs razorpay                 INR 149 a month and INR 1,199 a year (from src/config/plans.ts)
//   node scripts/billing/create-plans.mjs paypal --price 2.00 --currency USD [--yearly 20.00]
//
// Razorpay amounts are the FinTrack One INR prices. PayPal cannot charge INR from most accounts, so the international
// price is an owner decision and has no default: pass it explicitly. Live keys are refused by design; create live
// plans in each provider's dashboard after the owner approves going live.
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
const [, , provider, ...rest] = process.argv;
const arg = (n) => rest[rest.indexOf(`--${n}`) + 1];

async function razorpay() {
  const id = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!id || !secret) throw new Error("Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (sandbox) first.");
  if (!id.startsWith("rzp_test_")) throw new Error("Refusing to use a non-sandbox Razorpay key.");
  const auth = "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
  for (const [period, amount, envName] of [["monthly", 14900, "RAZORPAY_PLAN_ID_ONE_MONTHLY"], ["yearly", 119900, "RAZORPAY_PLAN_ID_ONE_YEARLY"]]) {
    const res = await fetch("https://api.razorpay.com/v1/plans", { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify({ period, interval: 1, item: { name: `FinTrack One (${period})`, amount, currency: "INR", description: "FinTrack One" } }) });
    const j = await res.json().catch(() => ({}));
    console.log(res.ok ? `${envName}=${j.id}` : `${period}: failed with HTTP ${res.status}`);
  }
}

async function paypal() {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (sandbox) first.");
  if ((process.env.PAYPAL_ENVIRONMENT ?? "sandbox").toLowerCase() === "live") throw new Error("Refusing to run against PayPal live.");
  const price = arg("price");
  const currency = arg("currency");
  if (!price || !/^\d+(\.\d{2})?$/.test(price) || !/^[A-Z]{3}$/.test(currency ?? "")) throw new Error("Pass --price 2.00 --currency USD (the international price is the owner's decision).");
  const base = "https://api-m.sandbox.paypal.com";
  const tokenRes = await fetch(`${base}/v1/oauth2/token`, { method: "POST", headers: { authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"), "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  const token = (await tokenRes.json().catch(() => ({}))).access_token;
  if (!token) throw new Error(`PayPal sign-in failed with HTTP ${tokenRes.status}`);
  const call = async (path, body) => {
    const res = await fetch(base + path, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", prefer: "return=representation" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${path} failed with HTTP ${res.status}`);
    return j;
  };
  const product = await call("/v1/catalogs/products", { name: "FinTrack One", type: "SERVICE", category: "SOFTWARE" });
  const plans = [["MONTH", price, "PAYPAL_PLAN_ID_ONE_MONTHLY"], ...(arg("yearly") ? [["YEAR", arg("yearly"), "PAYPAL_PLAN_ID_ONE_YEARLY"]] : [])];
  for (const [unit, value, envName] of plans) {
    const plan = await call("/v1/billing/plans", {
      product_id: product.id,
      name: `FinTrack One (${unit.toLowerCase()}ly)`,
      status: "ACTIVE",
      billing_cycles: [{ frequency: { interval_unit: unit, interval_count: 1 }, tenure_type: "REGULAR", sequence: 1, total_cycles: 0, pricing_scheme: { fixed_price: { value, currency_code: currency } } }],
      payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 3 },
    });
    console.log(`${envName}=${plan.id}`);
  }
}

try {
  if (provider === "razorpay") await razorpay();
  else if (provider === "paypal") await paypal();
  else console.log("Usage: node scripts/billing/create-plans.mjs razorpay | paypal --price 2.00 --currency USD [--yearly 20.00]");
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
