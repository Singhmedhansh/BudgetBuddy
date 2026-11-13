import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { EmptyState, Money, PageHeader } from "@/components/app/ui";
import { RefundForm } from "@/components/app/txn-forms";
import { formatMoney, toDecimalString } from "@/domain/money";
import { localDate } from "@/domain/period";
import { atLeast, requireSpace } from "@/server/context";
import { listAccounts } from "@/server/queries";
import { loadRefundContext } from "@/server/refunds";

export const metadata: Metadata = { title: "Refund an expense" };

export default async function RefundPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const ctx = await requireSpace();
  const back = { href: "/app/transactions" };
  if (!atLeast(ctx.role, "editor")) {
    return (
      <>
        <PageHeader back={back} title="Refund an expense" />
        <EmptyState title="View-only access" body="You can see this space but not change it. Ask an admin for editor access to record refunds." />
      </>
    );
  }
  const rc = await loadRefundContext(ctx, id);
  if (!rc) {
    return (
      <>
        <PageHeader back={back} title="Refund an expense" />
        <EmptyState title="This expense cannot be refunded" body="Only a posted expense that has not been reversed can be refunded." action={{ href: "/app/transactions", label: "Back to transactions" }} />
      </>
    );
  }
  const accounts = await listAccounts(ctx);
  const t = localDate(new Date(), ctx.profile.timezone);
  const today = `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
  const c = ctx.space.currency;
  return (
    <div className="max-w-lg">
      <PageHeader back={back} title="Refund an expense" description={`${rc.label}${rc.categoryName ? `, ${rc.categoryName}` : ""}. A refund reduces spending in the same category and puts the money back in an account. The original stays in your history.`} />
      {rc.remaining <= 0 ? (
        <EmptyState title="Fully refunded" body="Nothing is left to refund on this expense." action={{ href: "/app/transactions", label: "Back to transactions" }} />
      ) : (
        <>
          <p className="mb-6 text-sm text-muted">
            Original <Money minor={rc.amount} currency={c} className="font-medium text-fg" />, left to refund <Money minor={rc.remaining} currency={c} className="font-medium text-fg" />
          </p>
          <RefundForm id={id} remainingText={formatMoney(rc.remaining, c)} remainingPlain={toDecimalString(rc.remaining, c)} today={today} accounts={accounts.map((a) => ({ id: a.id, name: a.name }))} defaultAccountId={rc.accountId} />
        </>
      )}
    </div>
  );
}
