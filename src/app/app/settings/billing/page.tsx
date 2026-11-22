import type { Metadata } from "next";
import Link from "next/link";
import { CancelButton, CheckoutPanel } from "@/components/app/BillingActions";
import { formatDate, Money, Notice } from "@/components/app/ui";
import { formatPrice, planById, planName, priceFor, TRIAL_DAYS, type Interval } from "@/config/plans";
import { getContext } from "@/server/context";
import { checkoutProviders, isRazorpayOrderMode, razorpayConfig } from "@/server/payments/config";
import { resolveEntitlement, type EntitlementRow } from "@/server/payments/entitlements";
import { loadTrialStatus, trialCountdown } from "@/server/payments/trial-status";

export const metadata: Metadata = { title: "Plan and billing" };

interface SubRow { status: string; interval: Interval; provider: string; current_period_end: string | null; cancel_at_period_end: boolean; canceled_at: string | null; amount_minor: number; currency: string }
interface PayRow { id: string; amount_minor: number; currency: string; status: string; paid_at: string | null; created_at: string; failure_reason: string | null }

const CHECKOUT_NOTICE: Record<string, { kind: "success" | "error"; text: string }> = {
  success: { kind: "success", text: "You are all set. FinTrack One is active." },
  pending: { kind: "success", text: "Thank you. Your approval is in and your plan will switch on as soon as the payment is confirmed." },
  cancelled: { kind: "error", text: "Checkout was cancelled. You have not been charged." },
  failed: { kind: "error", text: "We could not confirm that payment. If money left your account, contact support and we will sort it out." },
};
const PAYMENT_LABEL: Record<string, string> = { created: "Started", authorized: "Authorised", captured: "Paid", failed: "Failed", partially_refunded: "Partly refunded", refunded: "Refunded" };
const WHY: Record<string, string> = {
  free: "You are on the Free plan.",
  paid: "Your plan is active.",
  trial: "You are on a trial.",
  grace: "Your last renewal did not go through. FinTrack One stays on for a short grace period while it is retried.",
  lapsed: "Your paid period has ended, so you are back on the Free plan.",
};

export default async function BillingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await getContext();
  // Every read below is the signed-in person's own, through row-level security.
  const [{ data: ent }, { data: subs }, { data: pays }, { count: startedBefore }] = await Promise.all([
    supabase.from("entitlements").select("plan,status,current_period_end").maybeSingle(),
    supabase.from("billing_subscriptions").select("status,interval,provider,current_period_end,cancel_at_period_end,canceled_at,amount_minor,currency").neq("status", "pending").order("created_at", { ascending: false }).limit(1),
    supabase.from("billing_payments").select("id,amount_minor,currency,status,paid_at,created_at,failure_reason").order("created_at", { ascending: false }).limit(12),
    supabase.from("billing_subscriptions").select("id", { count: "exact", head: true }).not("started_at", "is", null),
  ]);
  const entitlement = resolveEntitlement(ent as EntitlementRow | null, new Date());
  const sub = ((subs ?? []) as SubRow[])[0] ?? null;
  const payments = (pays ?? []) as PayRow[];
  const providers = checkoutProviders();
  const one = planById("pro");
  const inrPrices = { month: formatPrice(priceFor(one, "month")!), year: formatPrice(priceFor(one, "year")!) };
  const usdPrices = { month: formatPrice(priceFor(one, "month", "USD")!), year: formatPrice(priceFor(one, "year", "USD")!) };
  // How much the yearly plan saves against twelve months of the monthly one, per currency.
  const saving = (cur: "INR" | "USD") => Math.max(0, Math.round((1 - priceFor(one, "year", cur)!.amountMinor / (12 * priceFor(one, "month", cur)!.amountMinor)) * 100));
  // One free trial per person: a person whose subscription has ever started pays from day one.
  const trialEligible = (startedBefore ?? 0) === 0;
  // In the free days: an active subscription with no payment on record yet. The first charge is on the date shown.
  const trialStatus = await loadTrialStatus(supabase);
  const trialing = trialStatus.trialing;
  const countdown = trialStatus.endsAt ? trialCountdown(trialStatus.endsAt, new Date()).label : null;
  const paid = entitlement.plan === "pro";
  const tz = profile.timezone;
  const live = sub && (sub.status === "active" || sub.status === "past_due");
  const notice = sp.checkout ? CHECKOUT_NOTICE[sp.checkout] : undefined;
  const endsOn = entitlement.until ? formatDate(entitlement.until, tz) : null;

  return (
    <>
      {notice ? <Notice kind={notice.kind}>{notice.text}</Notice> : null}
      {providers.testMode && (providers.razorpay.length > 0 || providers.paypal.length > 0) ? (
        <p role="note" className="rounded-md border border-warn/50 bg-warn/10 px-3 py-2.5 text-sm text-warn-text">
          Payments are in test mode. No real money moves, and test cards or sandbox accounts are the only ones that work.
        </p>
      ) : null}

      <section aria-labelledby="plan">
        <h2 id="plan" className="mb-4 font-semibold">
          Your plan
        </h2>
        <div className="rounded-xl border border-line bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-display text-xl">{planName(entitlement.plan)}</p>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${paid ? "bg-pos/15 text-pos-text" : "bg-sunken text-muted"}`}>{paid ? (trialing ? `Free trial${countdown ? ` · ${countdown.toLowerCase()}` : ""}` : sub?.cancel_at_period_end || sub?.status === "canceled" ? "Ends soon" : entitlement.reason === "grace" ? "Payment failed" : "Active") : "Free"}</span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted">{trialing && paid ? (trialStatus.cancelled ? `You are on your free trial of FinTrack One. ${countdown ?? ""}. You cancelled, so nothing will be charged and FinTrack One stops at the end of the trial.` : `You are on your free trial of FinTrack One. ${countdown ?? ""}. Your first ${sub?.interval === "month" ? "month" : "year"} is then charged automatically unless you cancel before then.`) : WHY[entitlement.reason]}</p>
          {paid && endsOn ? (
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted">{sub?.cancel_at_period_end || sub?.status === "canceled" ? (trialing ? "Trial ends on" : "Access until") : entitlement.reason === "grace" ? "Last paid until" : trialing ? "First charge on" : "Renews on"}</dt>
                <dd className="font-medium">{endsOn}</dd>
              </div>
              {sub ? (
                <div>
                  <dt className="text-muted">Billing</dt>
                  <dd className="font-medium">
                    <Money minor={sub.amount_minor} currency={sub.currency} /> {sub.interval === "month" ? "monthly" : "yearly"} via {sub.provider === "razorpay" ? "Razorpay" : "PayPal"}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          {sub?.canceled_at ? <p className="mt-3 text-sm text-muted">Cancellation requested on {formatDate(sub.canceled_at, tz)}. It will not renew.</p> : null}
          {live && !sub.cancel_at_period_end ? <div className="mt-5"><CancelButton endsOn={endsOn} trial={trialing} /></div> : null}
        </div>
      </section>

      {!paid || entitlement.reason === "lapsed" ? (
        <section aria-labelledby="upgrade">
          <h2 id="upgrade" className="mb-2 font-semibold">
            {trialEligible ? `Try ${one.name} free for ${TRIAL_DAYS} days` : `Upgrade to ${one.name}`}
          </h2>
          <p className="mb-4 text-sm leading-relaxed text-muted">
            {one.summary} {trialEligible ? `Free for ${TRIAL_DAYS} days, then charged automatically unless you cancel first. Choose monthly (${inrPrices.month}, or ${usdPrices.month} outside India) or yearly (${inrPrices.year}, or ${usdPrices.year}).` : `Choose monthly (${inrPrices.month}, or ${usdPrices.month} outside India) or yearly (${inrPrices.year}, or ${usdPrices.year}). Cancel any time.`}
          </p>
          <ul className="mb-5 space-y-1.5 text-sm">
            {one.features.map((f) => (
              <li key={f} className="flex gap-2">
                <span aria-hidden className="text-primary">
                  ✓
                </span>
                {f}
              </li>
            ))}
          </ul>
          <CheckoutPanel razorpay={providers.razorpay} paypal={providers.paypal} paypalTrial={providers.paypalTrial} defaultProvider={profile.country === "IN" ? "razorpay" : "paypal"} prices={{ razorpay: inrPrices, paypal: usdPrices }} savings={{ razorpay: saving("INR"), paypal: saving("USD") }} trial={trialEligible} trialDays={TRIAL_DAYS} razorpayOneTime={(() => { const rz = razorpayConfig(); return !!rz && isRazorpayOrderMode(rz); })()} />
        </section>
      ) : null}

      <section aria-labelledby="history">
        <h2 id="history" className="mb-4 font-semibold">
          Billing history
        </h2>
        {payments.length === 0 ? (
          <p className="text-sm text-muted">No payments yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Your payments, newest first</caption>
              <thead className="bg-sunken text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">Date</th>
                  <th scope="col" className="px-4 py-2 font-medium">Amount</th>
                  <th scope="col" className="px-4 py-2 font-medium">Status</th>
                  <th scope="col" className="px-4 py-2 font-medium"><span className="sr-only">Invoice</span></th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-t border-line">
                    <td className="px-4 py-2.5">{formatDate(p.paid_at ?? p.created_at, tz)}</td>
                    <td className="px-4 py-2.5"><Money minor={p.amount_minor} currency={p.currency} /></td>
                    <td className="px-4 py-2.5">
                      <span className={p.status === "failed" ? "text-neg-text" : ""}>{PAYMENT_LABEL[p.status] ?? p.status}</span>
                      {p.status === "failed" && p.failure_reason ? <span className="block text-xs text-muted">{p.failure_reason}</span> : null}
                    </td>
                    <td className="px-4 py-2.5 text-right">{["captured", "partially_refunded", "refunded"].includes(p.status) ? <Link href={`/app/settings/billing/invoices/${p.id}`} className="font-medium text-primary underline-offset-2 hover:underline">Invoice</Link> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-sm text-muted">Billing questions: use Help Centre → Contact. We never see or store your card details.</p>
      </section>
    </>
  );
}
