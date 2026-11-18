"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Provider = "razorpay" | "paypal";
type Interval = "month" | "year";

interface RazorpayCheckoutResponse {
  razorpay_payment_id: string;
  razorpay_subscription_id: string;
  razorpay_signature: string;
}
interface RazorpayInstance {
  open(): void;
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

export interface CheckoutProps {
  /** Which providers can start a checkout, and for which periods. Never keys or ids. */
  razorpay: Interval[];
  paypal: Interval[];
  defaultProvider: Provider;
  prices: Record<Interval, string>;
}

export function CheckoutPanel({ razorpay, paypal, defaultProvider, prices }: CheckoutProps) {
  const router = useRouter();
  const available: Provider[] = [...(razorpay.length ? (["razorpay"] as const) : []), ...(paypal.length ? (["paypal"] as const) : [])];
  const [provider, setProvider] = useState<Provider>(available.includes(defaultProvider) ? defaultProvider : available[0]);
  const periods = provider === "razorpay" ? razorpay : paypal;
  const [interval, setInterval] = useState<Interval>("month");
  const chosen: Interval = periods.includes(interval) ? interval : periods[0];
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  async function pay() {
    setBusy(true);
    setNote(null);
    try {
      if (provider === "paypal") {
        const r = await post<{ approveUrl?: string }>("/api/billing/paypal/checkout", { interval: chosen });
        if (!r.ok || !r.data.approveUrl) throw new Error(r.data.message ?? "Could not start PayPal.");
        window.location.assign(r.data.approveUrl);
        return; // leaving the page: keep the button disabled
      }
      const r = await post<{ keyId: string; subscriptionId: string; name: string; description: string; email: string }>("/api/billing/razorpay/checkout", { interval: chosen });
      if (!r.ok) throw new Error(r.data.message ?? "Could not start checkout.");
      await loadCheckout();
      if (!window.Razorpay) throw new Error("Payment window could not load. Check your connection and try again.");
      const rz = new window.Razorpay({
        key: r.data.keyId,
        subscription_id: r.data.subscriptionId,
        name: r.data.name,
        description: r.data.description,
        prefill: { email: r.data.email },
        theme: { color: "#245c48" },
        modal: { ondismiss: () => setBusy(false) },
        handler: async (resp: RazorpayCheckoutResponse) => {
          setNote({ kind: "info", text: "Payment received. Confirming it with the bank…" });
          const v = await post<{ status?: string }>("/api/billing/razorpay/verify", resp);
          setNote(v.ok ? { kind: "info", text: v.data.status === "active" ? "Payment confirmed. FinTrack One is active." : "Payment received. Your plan will switch on as soon as the bank confirms it." } : { kind: "error", text: v.data.message ?? "We could not verify this payment." });
          setBusy(false);
          router.refresh();
        },
      });
      rz.open();
    } catch (e) {
      setNote({ kind: "error", text: e instanceof Error && e.message ? e.message : "Something went wrong. Please try again." });
      setBusy(false);
    }
  }

  if (available.length === 0) return <p className="text-sm text-muted">Payments are not switched on yet. Your Free plan keeps working in the meantime.</p>;
  return (
    <div className="space-y-5">
      {available.length > 1 ? (
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Where are you paying from?</legend>
          <div className="flex flex-wrap gap-2">
            {available.map((p) => (
              <label key={p} className={`cursor-pointer rounded-full border px-4 py-1.5 text-sm transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${provider === p ? "border-primary bg-sage font-medium" : "border-line-strong hover:border-primary"}`}>
                <input type="radio" name="provider" value={p} checked={provider === p} onChange={() => setProvider(p)} className="sr-only" />
                {p === "razorpay" ? "India (UPI, cards, netbanking)" : "International (PayPal)"}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {periods.length > 1 ? (
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Billing period</legend>
          <div className="flex flex-wrap gap-2">
            {periods.map((i) => (
              <label key={i} className={`cursor-pointer rounded-full border px-4 py-1.5 text-sm transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${chosen === i ? "border-primary bg-sage font-medium" : "border-line-strong hover:border-primary"}`}>
                <input type="radio" name="interval" value={i} checked={chosen === i} onChange={() => setInterval(i)} className="sr-only" />
                {i === "month" ? "Monthly" : "Yearly"}
                {provider === "razorpay" ? <span className="num ml-2 text-muted">{prices[i]}</span> : null}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <button type="button" onClick={pay} disabled={busy} className="rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-fg transition-all hover:-translate-y-px hover:bg-primary-hover disabled:opacity-60">
        {busy ? "Working…" : provider === "razorpay" ? `Subscribe for ${prices[chosen]}${chosen === "month" ? " a month" : " a year"}` : "Continue to PayPal"}
      </button>
      {provider === "paypal" ? <p className="text-sm text-muted">PayPal shows the exact price and currency before you approve anything.</p> : null}
      {note ? (
        <p role={note.kind === "error" ? "alert" : "status"} className={`rounded-md border px-3 py-2.5 text-sm ${note.kind === "error" ? "border-neg/50 bg-neg/10 text-neg-text" : "border-pos/50 bg-pos/10 text-pos-text"}`}>
          {note.text}
        </p>
      ) : null}
    </div>
  );
}

export function CancelButton({ endsOn }: { endsOn: string | null }) {
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
          Cancel subscription
        </button>
      ) : (
        <div role="group" aria-label="Confirm cancellation" className="space-y-3 rounded-xl border border-line bg-sunken p-4">
          <p className="text-sm leading-relaxed">You will keep FinTrack One{endsOn ? ` until ${endsOn}` : " until the end of the period you have paid for"}. It will not renew after that, and nothing is refunded.</p>
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
