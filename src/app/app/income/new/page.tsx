import type { Metadata } from "next";
import { RecurringForm } from "@/components/app/planning-forms";
import { EmptyState, PageHeader } from "@/components/app/ui";
import { requireSpace } from "@/server/context";
import { listAccounts, listCategories } from "@/server/queries";
import { todayFor } from "@/server/planning";

export const metadata: Metadata = { title: "Add expected income" };

export default async function Page() {
  const ctx = await requireSpace();
  const [accounts, categories] = await Promise.all([listAccounts(ctx), listCategories(ctx, "income")]);
  return (
    <div className="max-w-lg">
      <PageHeader title="Add expected income" />
      {accounts.length === 0 ? (
        <EmptyState title="Add an account first" body="Income is received into one of your accounts." action={{ href: "/app/accounts/new", label: "Add an account" }} />
      ) : (
        <RecurringForm kind="income" currency={ctx.space.currency} accounts={accounts} categories={categories} today={todayFor(ctx)} />
      )}
    </div>
  );
}
