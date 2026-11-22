import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/app/PrintButton";
import { formatDate, Money } from "@/components/app/ui";
import { BRAND } from "@/config/brand";
import { getContext } from "@/server/context";
import { buildInvoice, invoiceSeller, type InvoicePayment, type InvoiceSubscription } from "@/server/payments/invoice";

export const metadata: Metadata = { title: "Invoice" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS: Record<string, string> = { paid: "Paid", partially_refunded: "Partly refunded", refunded: "Refunded" };

/** An invoice for one payment that really went through. Read through row-level security, so only the payer sees it. */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { supabase, user, profile } = await getContext();
  const { data: pay } = await supabase.from("billing_payments").select("id,subscription_id,provider,provider_payment_id,provider_order_id,amount_minor,currency,status,paid_at,created_at").eq("id", id).maybeSingle();
  if (!pay) notFound();
  const payment = pay as InvoicePayment & { subscription_id: string | null };
  const { data: sub } = payment.subscription_id ? await supabase.from("billing_subscriptions").select("interval,current_period_start,current_period_end").eq("id", payment.subscription_id).maybeSingle() : { data: null };
  const invoice = buildInvoice(payment, (sub as InvoiceSubscription | null) ?? null, { name: profile.display_name, email: user.email ?? null }, invoiceSeller());
  if (!invoice) notFound(); // started, authorised-only and failed payments have no invoice
  const tz = profile.timezone;

  return (
    <article aria-labelledby="invoice-title" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/app/settings/billing" className="text-sm font-medium text-primary underline-offset-2 hover:underline">
          Back to billing
        </Link>
        <PrintButton />
      </div>

      <div className="rounded-xl border border-line bg-surface p-6 print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
          <div>
            <h1 id="invoice-title" className="font-display text-2xl">
              Invoice
            </h1>
            <p className="num mt-1 text-sm text-muted">{invoice.number}</p>
          </div>
          <div className="text-sm sm:text-right">
            <p className="font-semibold">{invoice.seller.name}</p>
            {invoice.seller.addressLines.map((l) => (
              <p key={l} className="text-muted">
                {l}
              </p>
            ))}
            {invoice.seller.gstin ? <p className="text-muted">GSTIN {invoice.seller.gstin}</p> : null}
            {invoice.seller.email ? <p className="text-muted">{invoice.seller.email}</p> : null}
          </div>
        </header>

        <dl className="grid gap-4 py-5 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted">Billed to</dt>
            <dd className="font-medium">{invoice.buyer.name ?? invoice.buyer.email ?? "FinTrack customer"}</dd>
            {invoice.buyer.name && invoice.buyer.email ? <dd className="text-muted">{invoice.buyer.email}</dd> : null}
          </div>
          <div>
            <dt className="text-muted">Date paid</dt>
            <dd className="font-medium">{formatDate(invoice.issuedAt, tz)}</dd>
          </div>
          <div>
            <dt className="text-muted">Status</dt>
            <dd className="font-medium">{STATUS[invoice.status]}</dd>
          </div>
        </dl>

        <table className="w-full text-left text-sm">
          <caption className="sr-only">Invoice items</caption>
          <thead className="bg-sunken text-muted">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Description</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-line">
              <td className="px-4 py-3">
                {invoice.description}
                {invoice.period.start && invoice.period.end ? <span className="block text-xs text-muted">{formatDate(invoice.period.start, tz)} to {formatDate(invoice.period.end, tz)}</span> : null}
              </td>
              <td className="px-4 py-3 text-right"><Money minor={invoice.amountMinor} currency={invoice.currency} /></td>
            </tr>
          </tbody>
          <tfoot>
            <tr className="border-t border-line-strong">
              <th scope="row" className="px-4 py-3 text-left font-semibold">Total paid</th>
              <td className="px-4 py-3 text-right font-semibold"><Money minor={invoice.amountMinor} currency={invoice.currency} /></td>
            </tr>
          </tfoot>
        </table>

        <footer className="mt-5 space-y-1 border-t border-line pt-4 text-xs text-muted">
          <p>
            Paid through {invoice.provider}. Payment reference <span className="num">{invoice.providerPaymentId}</span>.
          </p>
          <p>Prices include any applicable taxes. This is a receipt for a {BRAND.name} subscription period and does not renew automatically unless your billing page says it does.</p>
        </footer>
      </div>
    </article>
  );
}
