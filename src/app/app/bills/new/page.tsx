import type { Metadata } from "next";
import { RecurringForm } from "@/components/app/planning-forms";
import { EmptyState, PageHeader } from "@/components/app/ui";
import { requireSpace } from "@/server/context";
import { listAccounts, listCategories } from "@/server/queries";
import { todayFor } from "@/server/planning";

export const metadata: Metadata = { title: "Add bill" };

export default async function Page() {
  const ctx = await requireSpace();
  const [accounts, categories] = await Promise.all([listAccounts(ctx), listCategories(ctx, "expense")]);
  return (
    <div className="max-w-lg">
      <PageHeader back={{ href: "/app/bills" }} title="Add bill" />
      {accounts.length === 0 ? (
        <EmptyState title="Add an account first" body="A bill is paid from one of your accounts." action={{ href: "/app/accounts/new", label: "Add an account" }} />
      ) : (
        <RecurringForm kind="bill" currency={ctx.space.currency} accounts={accounts} categories={categories} today={todayFor(ctx)} />
      )}
    </div>
  );
}
