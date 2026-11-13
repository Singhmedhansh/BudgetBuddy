import type { Metadata } from "next";
import { TransactionForm } from "@/components/app/forms";
import { EmptyState, PageHeader } from "@/components/app/ui";
import { localDate } from "@/domain/period";
import { requireSpace } from "@/server/context";
import { listAccounts, listCategories } from "@/server/queries";

export const metadata: Metadata = { title: "Add transaction" };

export default async function NewTransactionPage() {
  const ctx = await requireSpace();
  const [accounts, expense, income] = await Promise.all([listAccounts(ctx), listCategories(ctx, "expense"), listCategories(ctx, "income")]);
  const d = localDate(new Date(), ctx.profile.timezone);
  const today = `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

  return (
    <div className="max-w-lg">
      <PageHeader back={{ href: "/app/transactions" }} title="Add transaction" />
      {accounts.length === 0 ? (
        <EmptyState title="Add an account first" body="A transaction needs an account to come from or go into." action={{ href: "/app/accounts/new", label: "Add an account" }} />
      ) : (
        <TransactionForm accounts={accounts} expenseCategories={expense} incomeCategories={income} today={today} />
      )}
    </div>
  );
}
