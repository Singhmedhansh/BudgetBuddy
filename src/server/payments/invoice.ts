import { BRAND } from "@/config/brand";
import { planName } from "@/config/plans";
import type { Interval } from "./types";

/** Who is selling. Read from the server environment so no business detail is invented or hard-coded. */
export interface InvoiceSeller {
  name: string;
  addressLines: string[];
  gstin: string | null;
  email: string | null;
}

export function invoiceSeller(env: Record<string, string | undefined> = process.env): InvoiceSeller {
  const t = (v: string | undefined) => v?.trim() || null;
  return {
    name: t(env.INVOICE_SELLER_NAME) ?? BRAND.name,
    addressLines: (t(env.INVOICE_SELLER_ADDRESS) ?? "").split("|").map((l) => l.trim()).filter(Boolean),
    gstin: t(env.INVOICE_GSTIN),
    email: t(env.INVOICE_SUPPORT_EMAIL) ?? t(env.SUPPORT_EMAIL),
  };
}

export interface InvoicePayment {
  id: string;
  provider: "razorpay" | "paypal";
  provider_payment_id: string;
  provider_order_id?: string | null;
  amount_minor: number;
  currency: string;
  status: string;
  paid_at: string | null;
  created_at: string;
}
export interface InvoiceSubscription {
  interval: Interval;
  current_period_start: string | null;
  current_period_end: string | null;
}

export interface Invoice {
  number: string;
  issuedAt: string;
  status: "paid" | "partially_refunded" | "refunded";
  seller: InvoiceSeller;
  buyer: { name: string | null; email: string | null };
  description: string;
  period: { start: string | null; end: string | null };
  amountMinor: number;
  currency: string;
  provider: "Razorpay" | "PayPal";
  providerPaymentId: string;
}

/** Only a payment that really went through has an invoice. A started, authorised-only or failed payment does not. */
export const INVOICEABLE = ["captured", "partially_refunded", "refunded"] as const;

/** FT-202611-1A2B3C4D: year and month of payment, then the first characters of the ledger row id. Stable and unique. */
export function invoiceNumber(p: Pick<InvoicePayment, "id" | "paid_at" | "created_at">): string {
  const d = new Date(p.paid_at ?? p.created_at);
  const ym = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  return `FT-${ym}-${p.id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

/** Builds the invoice from the ledger, or null when the payment is not one that was paid. Amounts are the recorded ones. */
export function buildInvoice(payment: InvoicePayment, sub: InvoiceSubscription | null, buyer: { name: string | null; email: string | null }, seller: InvoiceSeller): Invoice | null {
  if (!(INVOICEABLE as readonly string[]).includes(payment.status)) return null;
  const interval = sub?.interval ?? null;
  return {
    number: invoiceNumber(payment),
    issuedAt: payment.paid_at ?? payment.created_at,
    status: payment.status === "captured" ? "paid" : (payment.status as "partially_refunded" | "refunded"),
    seller,
    buyer,
    description: `${planName("pro")}${interval ? ` (${interval === "month" ? "1 month" : "1 year"})` : ""}`,
    period: { start: sub?.current_period_start ?? null, end: sub?.current_period_end ?? null },
    amountMinor: payment.amount_minor,
    currency: payment.currency,
    provider: payment.provider === "razorpay" ? "Razorpay" : "PayPal",
    providerPaymentId: payment.provider_payment_id,
  };
}
