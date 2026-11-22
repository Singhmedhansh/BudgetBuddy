"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Provider = "razorpay" | "paypal";
type Interval = "month" | "year";

interface RazorpayCheckoutResponse {
  razorpay_payment_id: string;
  razorpay_order_id?: string;
  razorpay_subscription_id?: string;
  razorpay_signature: string;
}
interface RazorpayInstance {
  open(): void;
  on(event: "payment.failed", cb: (response: { error?: { description?: string } }) => void): void;
}
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

let scriptPromise: Promise<void> | null = null;
/** Razorpay Checkout is loaded only when someone chooses to pay, never on ordinary page loads. */
function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error("load"));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

async function post<T>(url: string, body: unknown): Promise<{ ok: boolean; data: T & { message?: string } }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { ok: res.ok, data: (await res.json().catch(() => ({}))) as T & { message?: string } };
}

export interface PlanPrices {
  month: string;
  year: string;
}

export interface CheckoutProps {
  /** Which providers can start a checkout, and for which periods. Never keys or ids. */
  razorpay: Interval[];
  paypal: Interval[];
  /** The PayPal periods that have a free-trial plan. */
  paypalTrial: Interval[];
  defaultProvider: Provider;
  /** Formatted prices in the currency each provider charges. */
  prices: { razorpay: PlanPrices; paypal: PlanPrices };
  /** How much cheaper the yearly plan is than twelve months, in percent, per provider. */
  savings: { razorpay: number; paypal: number };
  /** This person can start the free trial (first subscription only). */
  trial?: boolean;
  trialDays?: number;
  /** Razorpay sells one-time prepaid periods (no auto-renew) rather than a recurring subscription. */
  razorpayOneTime?: boolean;
  /** What the order summary names and lists. */
  planName: string;
  features: string[];
}

const PROVIDER_NAME: Record<Provider, string> = { razorpay: "Razorpay", paypal: "PayPal" };
const pill = (on: boolean) => `cursor-pointer rounded-full border px-4 py-1.5 text-sm transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${on ? "border-primary bg-sage font-medium" : "border-line-strong hover:border-primary"}`;

export function CheckoutPanel({ razorpay, paypal, paypalTrial, defaultProvider, prices, savings, trial = false, trialDays = 0, razorpayOneTime = false, planName, features }: CheckoutProps) {
  const router = useRouter();
  const available: Provider[] = [...(razorpay.length ? (["razorpay"] as const) : []), ...(paypal.length ? (["paypal"] as const) : [])];
  const [provider, setProvider] = useState<Provider>(available.includes(defaultProvider) ? defaultProvider : available[0]);
  const periods = provider === "razorpay" ? razorpay : paypal;
  const [interval, setInterval] = useState<Interval>("year");
  const chosen: Interval = periods.includes(interval) ? interval : periods[0];
  const [openedAt] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  // A promotion code. It counts only for the provider and period it was checked for.
  const [code, setCode] = useState("");
  const [applied, setApplied] = useState<{ code: string; days: number; key: string } | null>(null);
  const [codeNote, setCodeNote] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const key = `${provider}:${chosen}`;
  const subscription = provider === "paypal" || !razorpayOneTime;
  const coupon = applied && applied.key === key ? applied : null;
  const trialHere = subscription && trial && (provider === "razorpay" ? true : paypalTrial.includes(chosen));
  const days = coupon ? coupon.days : trialDays;
  const price = prices[provider][chosen];
  const per = chosen === "month" ? "month" : "year";

  async function applyCode(): Promise<boolean> {
    const text = code.trim();
    if (!text) return true;
    if (coupon && coupon.code === text.toUpperCase().replace(/\s+/g, "")) return true;
    setCodeNote(null);
    const r = await post<{ valid?: boolean; code?: string; trialDays?: number }>("/api/billing/coupon", { code: text, interval: chosen, provider });
    if (!r.ok || !r.data.valid || !r.data.trialDays) {
      setApplied(null);
      setCodeNote({ kind: "error", text: r.data.message ?? "That code did not work." });
      return false;
    }
    setApplied({ code: r.data.code ?? text, days: r.data.trialDays, key });
    setCodeNote({ kind: "ok", text: `${r.data.code ?? text} applied: ${r.data.trialDays} days free.` });
    return true;
  }

  /** Asks the server to look the payment up at Razorpay, for a closed tab or a lost connection. */
  async function checkStatus() {
    setBusy(true);
    setNote({ kind: "info", text: "Checking with Razorpay…" });
    const r = await post<{ status?: string; paid?: boolean }>("/api/billing/razorpay/status", {});
    setBusy(false);
    if (!r.ok) return setNote({ kind: "error", text: r.data.message ?? "Could not check right now. Please try again." });
    setNote(r.data.paid ? { kind: "info", text: "Payment confirmed. FinTrack One is active." } : r.data.status === "processing" ? { kind: "info", text: "Payment found. Your plan will switch on shortly." } : { kind: "info", text: "No completed payment found. If money left your account, contact support and we will sort it out." });
    if (r.data.paid) router.push("/app/billing?checkout=success");
    else router.refresh();
  }

  async function pay() {
    setBusy(true);
    setNote(null);
    try {
      if (code.trim() && trialHere && !(await applyCode())) {
        setBusy(false);
        return;
      }
      const withCode = trialHere && code.trim() ? { coupon: code.trim() } : {};
      if (provider === "paypal") {
        const r = await post<{ approveUrl?: string }>("/api/billing/paypal/checkout", { interval: chosen, ...withCode });
        if (!r.ok || !r.data.approveUrl) throw new Error(r.data.message ?? "Could not start PayPal.");
        window.location.assign(r.data.approveUrl);
        return; // leaving the page: keep the button disabled
      }
      const r = await post<{ keyId: string; orderId?: string; subscriptionId?: string; trial?: boolean; name: string; description: string; email: string }>("/api/billing/razorpay/checkout", { interval: chosen, ...withCode });
      if (!r.ok) throw new Error(r.data.message ?? "Could not start checkout.");
      await loadCheckout();
      if (!window.Razorpay) throw new Error("Payment window could not load. Check your connection and try again.");
      const rz = new window.Razorpay({
        key: r.data.keyId,
        ...(r.data.orderId ? { order_id: r.data.orderId } : { subscription_id: r.data.subscriptionId }),
        name: r.data.name,
        description: r.data.description,
        prefill: { email: r.data.email },
        theme: { color: "#245c48" },
        modal: { ondismiss: () => { setBusy(false); setNote({ kind: "info", text: "Payment cancelled. You have not been charged." }); } },
        handler: async (resp: RazorpayCheckoutResponse) => {
          setNote({ kind: "info", text: "Payment received. Confirming it with the bank…" });
          const v = await post<{ status?: string }>("/api/billing/razorpay/verify", resp);
          setNote(v.ok ? { kind: "info", text: v.data.status === "active" ? (r.data.trial ? "You are all set. Your free trial has started." : "Payment confirmed. FinTrack One is active.") : "Payment received. Your plan will switch on as soon as the bank confirms it." } : { kind: "error", text: v.data.message ?? "We could not verify this payment." });
          setBusy(false);
          if (v.ok && v.data.status === "active") router.push("/app/billing?checkout=success");
          else router.refresh();
        },
      });
      rz.on("payment.failed", (f: { error?: { description?: string } }) => {
        setNote({ kind: "error", text: f.error?.description ? `Payment failed: ${f.error.description}` : "Payment failed. Please try again or use another method." });
        setBusy(false);
      });
      rz.open();
    } catch (e) {
      setNote({ kind: "error", text: e instanceof Error && e.message ? e.message : "Something went wrong. Please try again." });
      setBusy(false);
    }
  }

  if (available.length === 0) return <p className="text-sm text-muted">Payments are not switched on yet. Your Free plan keeps working in the meantime.</p>;
  const firstCharge = new Date(openedAt + days * 86_400_000).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const dueToday = trialHere ? "Free" : price;
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
      <div className="space-y-7">
        {available.length > 1 ? (
          <fieldset>
            <legend className="mb-2 font-semibold">1. Where are you paying from?</legend>
            <div className="flex flex-wrap gap-2">
              {available.map((p) => (
                <label key={p} className={pill(provider === p)}>
                  <input type="radio" name="provider" value={p} checked={provider === p} onChange={() => setProvider(p)} className="sr-only" />
                  {p === "razorpay" ? "India (UPI, cards, netbanking)" : "International (PayPal)"}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        {periods.length > 1 ? (
          <fieldset>
            <legend className="mb-2 font-semibold">{available.length > 1 ? "2. " : "1. "}Choose how often you pay</legend>
            <div className="flex flex-wrap gap-2">
              {periods.map((i) => (
                <label key={i} className={pill(chosen === i)}>
                  <input type="radio" name="interval" value={i} checked={chosen === i} onChange={() => setInterval(i)} className="sr-only" />
                  {i === "month" ? "Monthly" : "Yearly"}
                  <span className="num ml-2 text-muted">{prices[provider][i]}</span>
                  {i === "year" && savings[provider] > 0 ? <span className="ml-2 rounded-full bg-pos/15 px-2 py-0.5 text-xs font-medium text-pos-text">Save {savings[provider]}%</span> : null}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        {trialHere ? (
          <div>
            <label htmlFor="promo" className="mb-2 block font-semibold">
              Promo code <span className="font-normal text-muted">(optional)</span>
            </label>
            <div className="flex flex-wrap items-start gap-2">
              <input
                id="promo"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  setCodeNote(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void applyCode();
                  }
                }}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={40}
                aria-describedby="promo-note"
                className="num w-48 rounded-md border border-line-strong bg-surface px-3 py-2 text-sm uppercase outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
              />
              <button type="button" onClick={() => void applyCode()} disabled={busy || !code.trim()} className="rounded-full border border-line-strong px-4 py-2 text-sm font-medium transition-colors hover:border-primary disabled:opacity-60">
                Apply
              </button>
            </div>
            <p id="promo-note" role="status" className={`mt-2 text-sm ${codeNote?.kind === "error" ? "text-neg-text" : "text-pos-text"}`}>
              {codeNote?.text}
            </p>
          </div>
        ) : null}
        <ul className="space-y-1.5 text-sm">
          {features.map((f) => (
            <li key={f} className="flex gap-2">
              <span aria-hidden className="text-primary">
                ✓
              </span>
              {f}
            </li>
          ))}
        </ul>
      </div>
      <aside aria-labelledby="summary" className="space-y-4 rounded-xl border border-line bg-surface p-5 lg:sticky lg:top-6">
        <h2 id="summary" className="font-semibold">
          Order summary
        </h2>
        <div className="flex items-start justify-between gap-3 text-sm">
          <div>
            <p className="font-medium">{planName}</p>
            <p className="text-muted">
              {chosen === "month" ? "Monthly" : "Yearly"} · {PROVIDER_NAME[provider]}
            </p>
          </div>
          <p className="num font-medium">{price}</p>
        </div>
        {trialHere ? (
          <div className="flex items-center justify-between gap-3 border-t border-line pt-3 text-sm">
            <p>
              {coupon ? `${coupon.code}: ` : ""}
              {days}-day free trial
            </p>
            <p className="num text-pos-text">Free</p>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
          <p className="font-semibold">Due today</p>
          <p className="num font-display text-xl">{dueToday}</p>
        </div>
        {trialHere ? (
          <p className="text-sm text-muted">
            Then {price} on <span suppressHydrationWarning>{firstCharge}</span>, and every {per} after that. Cancel before then and you pay nothing.
          </p>
        ) : null}
        <button type="button" onClick={pay} disabled={busy} className="w-full rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-fg transition-all hover:-translate-y-px hover:bg-primary-hover disabled:opacity-60">
          {busy
            ? "Working…"
            : razorpayOneTime && provider === "razorpay"
              ? `Pay ${price} for 1 ${per}`
              : trialHere
                ? `Start your ${days}-day free trial`
                : provider === "razorpay"
                  ? `Subscribe for ${price} a ${per}`
                  : "Continue to PayPal"}
        </button>
        {provider === "razorpay" && razorpayOneTime ? (
          <div className="space-y-2">
            <p className="text-sm text-muted">One payment, no automatic renewal. Pay again when your period ends to keep FinTrack One.</p>
            <button type="button" onClick={checkStatus} disabled={busy} className="text-sm font-medium text-primary underline-offset-2 hover:underline disabled:opacity-60">
              Already paid? Check my payment
            </button>
          </div>
        ) : null}
        {trialHere ? (
          <p className="text-sm leading-relaxed text-muted">
            You will be charged automatically unless you cancel in Plan and billing before the trial ends.
            {provider === "razorpay" ? " In India a small authorisation of up to ₹5 may appear while your payment method is set up; it is refunded." : ""}
          </p>
        ) : subscription ? (
          <p className="text-sm leading-relaxed text-muted">
            You are charged {price} now and then every {per} until you cancel. Cancel any time in Plan and billing; you keep access to the end of the period you paid for.
          </p>
        ) : null}
        {provider === "paypal" ? <p className="text-sm text-muted">{PROVIDER_NAME.paypal} shows the exact price and currency before you approve anything.</p> : null}
        {note ? (
          <p role={note.kind === "error" ? "alert" : "status"} className={`rounded-md border px-3 py-2.5 text-sm ${note.kind === "error" ? "border-neg/50 bg-neg/10 text-neg-text" : "border-pos/50 bg-pos/10 text-pos-text"}`}>
            {note.text}
          </p>
        ) : null}
      </aside>
    </div>
  );
}

export function CancelButton({ endsOn, trial = false }: { endsOn: string | null; trial?: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function cancel() {
    setBusy(true);
    setError(null);
    const r = await post<unknown>("/api/billing/cancel", {});
    setBusy(false);
    if (!r.ok) return setError(r.data.message ?? "Could not cancel. Please try again.");
    setConfirming(false);
    router.refresh();
  }
  return (
    <div>
      {!confirming ? (
        <button type="button" onClick={() => setConfirming(true)} className="rounded-full border border-line-strong px-4 py-1.5 text-sm font-medium transition-colors hover:border-neg hover:text-neg-text">
          {trial ? "Cancel free trial" : "Cancel subscription"}
        </button>
      ) : (
        <div role="group" aria-label="Confirm cancellation" className="space-y-3 rounded-xl border border-line bg-sunken p-4">
          <p className="text-sm leading-relaxed">You will keep FinTrack One{endsOn ? ` until ${endsOn}` : " until the end of the period you have paid for"}. {trial ? "Nothing is charged if you cancel now." : "It will not renew after that, and nothing is refunded."}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={cancel} disabled={busy} className="rounded-full bg-neg px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-60">
              {busy ? "Cancelling…" : "Yes, cancel"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="rounded-full border border-line-strong px-4 py-1.5 text-sm font-medium">
              Keep my plan
            </button>
          </div>
        </div>
      )}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-neg-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
