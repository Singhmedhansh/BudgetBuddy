import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { BudgetForm } from "@/components/app/forms";
import { EmptyState, PageHeader } from "@/components/app/ui";
import { toDecimalString } from "@/domain/money";
import { atLeast, requireSpace } from "@/server/context";
import { listCategories } from "@/server/queries";

export const metadata: Metadata = { title: "Edit budget" };

export default async function EditBudgetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const ctx = await requireSpace();
  const { data: b } = await ctx.supabase.from("budgets").select("id,name,warn_at,rollover").eq("space_id", ctx.space.id).eq("id", id).is("archived_at", null).maybeSingle();
  if (!b) notFound();
  const back = { href: "/app/budgets" };
  if (!atLeast(ctx.role, "editor")) {
    return (
      <>
        <PageHeader back={back} title="Edit budget" />
        <EmptyState title="View-only access" body="Ask an admin for editor access to change budgets." />
      </>
    );
  }
  const [categories, { data: allocs }] = await Promise.all([listCategories(ctx, "expense"), ctx.supabase.from("budget_allocations").select("category_id,amount").eq("budget_id", id)]);
  const allocations = Object.fromEntries((allocs ?? []).map((a) => [a.category_id as string, toDecimalString(Number(a.amount), ctx.space.currency)]));
  return (
    <div className="max-w-2xl">
      <PageHeader back={back} title="Edit budget" description="Changes apply to this month's figures straight away. Clear a limit to stop budgeting that category." />
      <BudgetForm categories={categories} currency={ctx.space.currency} initial={{ id, name: b.name as string, warnAt: String(Math.round(Number(b.warn_at) * 100)), rollover: Boolean(b.rollover), allocations }} />
    </div>
  );
}
