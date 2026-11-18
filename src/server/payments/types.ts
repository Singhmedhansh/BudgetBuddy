import type { Interval } from "@/config/plans";

export type SubscriptionStatus = "pending" | "active" | "past_due" | "canceled" | "expired";
export type PaymentStatus = "created" | "authorized" | "captured" | "failed" | "partially_refunded" | "refunded";

/** Subscription fields a provider event may carry. Absent fields leave stored values alone. */
export interface SubscriptionPatch {
  provider_subscription_id: string;
  provider_customer_id?: string | null;
  status: SubscriptionStatus;
  current_period_start?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean;
  started_at?: string | null;
  canceled_at?: string | null;
}

export interface PaymentPatch {
  provider_payment_id: string;
  provider_order_id?: string | null;
  provider_subscription_id?: string | null;
  amount_minor: number;
  currency: string;
  status: PaymentStatus;
  failure_reason?: string | null;
  paid_at?: string | null;
}

/** One provider event, normalised. The database applies it atomically and idempotently (billing_apply_event). */
export interface BillingEvent {
  provider: "razorpay" | "paypal";
  eventId: string;
  eventType: string;
  eventAt: Date;
  userId: string | null;
  subscription: SubscriptionPatch | null;
  payment: PaymentPatch | null;
}

export type ApplyOutcome = "applied" | "duplicate" | "unmatched" | "stale";

/** Why a checkout could not start or finish. Each maps to a plain sentence for the person; none carries provider detail. */
export class BillingError extends Error {
  constructor(
    public readonly code: "not_configured" | "interval_unavailable" | "rate_limited" | "already_subscribed" | "plan_mismatch" | "amount_mismatch" | "owner_mismatch" | "not_found" | "provider_error" | "invalid_signature" | "invalid_request",
    public readonly status = 400,
  ) {
    super(`Billing error: ${code}`);
  }
}

export const BILLING_MESSAGES: Record<BillingError["code"], string> = {
  not_configured: "Payments are not switched on yet.",
  interval_unavailable: "That billing period is not available right now.",
  rate_limited: "Too many payment attempts. Please wait a little before trying again.",
  already_subscribed: "You already have an active FinTrack One subscription.",
  plan_mismatch: "We could not confirm the plan for this payment. You have not been charged for anything we could not verify; contact support if money left your account.",
  amount_mismatch: "We could not confirm the amount for this payment. Contact support if money left your account.",
  owner_mismatch: "This payment does not belong to your account.",
  not_found: "We could not find that payment.",
  provider_error: "The payment provider did not respond. Please try again in a moment.",
  invalid_signature: "We could not verify this payment.",
  invalid_request: "That request was not valid.",
};

export type { Interval };
