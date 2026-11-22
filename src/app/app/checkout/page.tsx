import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckoutPanel } from "@/components/app/BillingActions";
import { PageHeader } from "@/components/app/ui";
import { formatPrice, planById, priceFor, TRIAL_DAYS } from "@/config/plans";
import { getContext } from "@/server/context";
import { checkoutProviders, isRazorpayOrderMode, razorpayConfig } from "@/server/payments/config";
import { resolveEntitlement, type EntitlementRow } from "@/server/payments/entitlements";

export const metadata: Metadata = { title: "Checkout" };

/** The place to start or change a plan: choices on the left, the order summary and pay button on the right. */
export default async function CheckoutPage() {
  const { supabase, profile } = await getContext();
  const [{ data: ent }, { count: startedBefore }] = await Promise.all([
    supabase.from("entitlements").select("plan,status,current_period_end").maybeSingle(),
    supabase.from("billing_subscriptions").select("id", { count: "exact", head: true }).not("started_at", "is", null),
  ]);
  const entitlement = resolveEntitlement(ent as EntitlementRow | null, new Date());
  // Someone already on FinTrack One manages their plan in Plan and billing; a lapsed plan can check out again.
  if (entitlement.plan === "pro" && entitlement.reason !== "lapsed") redirect("/app/billing");

  const providers = checkoutProviders();
  const one = planById("pro");
  const inrPrices = { month: formatPrice(priceFor(one, "month")!), year: formatPrice(priceFor(one, "year")!) };
  const usdPrices = { month: formatPrice(priceFor(one, "month", "USD")!), year: formatPrice(priceFor(one, "year", "USD")!) };
  // How much the yearly plan saves against twelve months of the monthly one, per currency.
  const saving = (cur: "INR" | "USD") => Math.max(0, Math.round((1 - priceFor(one, "year", cur)!.amountMinor / (12 * priceFor(one, "month", cur)!.amountMinor)) * 100));
  // One free trial per person: a person whose subscription has ever started pays from day one.
  const trialEligible = (startedBefore ?? 0) === 0;
  const rz = razorpayConfig();

  return (
    <>
      <PageHeader
        title={trialEligible ? `Try ${one.name} free for ${TRIAL_DAYS} days` : `Upgrade to ${one.name}`}
        description={one.summary}
        back={{ href: "/app/billing", label: "Plan and billing" }}
      />
      {providers.testMode && (providers.razorpay.length > 0 || providers.paypal.length > 0) ? (
        <p role="note" className="mb-6 rounded-md border border-warn/50 bg-warn/10 px-3 py-2.5 text-sm text-warn-text">
          Payments are in test mode. No real money moves, and test cards or sandbox accounts are the only ones that work.
        </p>
      ) : null}
      <CheckoutPanel
        razorpay={providers.razorpay}
        paypal={providers.paypal}
        paypalTrial={providers.paypalTrial}
        defaultProvider={profile.country === "IN" ? "razorpay" : "paypal"}
        prices={{ razorpay: inrPrices, paypal: usdPrices }}
        savings={{ razorpay: saving("INR"), paypal: saving("USD") }}
        trial={trialEligible}
        trialDays={TRIAL_DAYS}
        razorpayOneTime={!!rz && isRazorpayOrderMode(rz)}
        planName={one.name}
        features={one.features}
      />
    </>
  );
}
