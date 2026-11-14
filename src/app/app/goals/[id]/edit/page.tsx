import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { GoalForm } from "@/components/app/planning-forms";
import { EmptyState, PageHeader } from "@/components/app/ui";
import { toDecimalString } from "@/domain/money";
import { addDays } from "@/domain/recurrence";
import { atLeast, requireSpace } from "@/server/context";
import { todayFor } from "@/server/planning";

export const metadata: Metadata = { title: "Edit goal" };

export default async function EditGoalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const ctx = await requireSpace();
  const { data: g } = await ctx.supabase.from("savings_goals").select("id,name,target_amount,deadline,priority,status").eq("space_id", ctx.space.id).eq("id", id).maybeSingle();
  if (!g || g.status === "archived") notFound();
  const back = { href: "/app/goals" };
  if (!atLeast(ctx.role, "editor")) {
    return (
      <>
        <PageHeader back={back} title="Edit goal" />
        <EmptyState title="View-only access" body="Ask an admin for editor access to change goals." />
      </>
    );
  }
  return (
    <div className="max-w-lg">
      <PageHeader back={back} title="Edit goal" description="Changing the target does not change what you have saved so far." />
      <GoalForm
        currency={ctx.space.currency}
        minDate={addDays(todayFor(ctx), 1)}
        initial={{ id, name: g.name as string, target: toDecimalString(Number(g.target_amount), ctx.space.currency), deadline: (g.deadline as string | null) ?? "", priority: String(g.priority) }}
      />
    </div>
  );
}
