import type { Metadata } from "next";
import { BudgetForm } from "@/components/app/forms";
import { PageHeader } from "@/components/app/ui";
import { requireSpace } from "@/server/context";
import { listCategories } from "@/server/queries";

export const metadata: Metadata = { title: "Create budget" };

export default async function NewBudgetPage() {
  const ctx = await requireSpace();
  const categories = await listCategories(ctx, "expense");
  return (
    <div className="max-w-2xl">
      <PageHeader back={{ href: "/app/budgets" }} title="Create budget" description="A monthly limit for each category you want to watch." />
      <BudgetForm categories={categories} currency={ctx.space.currency} />
    </div>
  );
}
