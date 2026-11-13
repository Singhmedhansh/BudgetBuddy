/**
 * Payments configuration. Live payments are disabled in code: `LIVE_PAYMENTS_ALLOWED` is a constant, not an
 * environment variable, so no setting can turn real charging on by accident. Sandbox is the default and the only mode.
 * Credentials come from server-only variables and are never exposed to the browser or placed in messages.
 *
 *   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
 *   PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID
 */
export const LIVE_PAYMENTS_ALLOWED = false as boolean;
export type PaymentProvider = "razorpay" | "paypal";

export interface PaymentsStatus {
  mode: "sandbox";
  /** Providers whose sandbox credentials are present. */
  configured: PaymentProvider[];
  /** True only when a provider is configured AND live payments are allowed. Always false today. */
  checkoutOpen: boolean;
}

export function paymentsStatus(env: Record<string, string | undefined> = process.env): PaymentsStatus {
  const configured: PaymentProvider[] = [];
  if (env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET) configured.push("razorpay");
  if (env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET) configured.push("paypal");
  return { mode: "sandbox", configured, checkoutOpen: LIVE_PAYMENTS_ALLOWED && configured.length > 0 };
}
