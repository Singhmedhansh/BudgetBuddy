import type { Metadata } from "next";
import { GoalForm } from "@/components/app/planning-forms";
import { PageHeader } from "@/components/app/ui";
import { addDays } from "@/domain/recurrence";
import { requireSpace } from "@/server/context";
import { todayFor } from "@/server/planning";

export const metadata: Metadata = { title: "Create goal" };

export default async function NewGoalPage() {
  const ctx = await requireSpace();
  return (
    <div className="max-w-lg">
      <PageHeader title="Create goal" />
      <GoalForm currency={ctx.space.currency} minDate={addDays(todayFor(ctx), 1)} />
    </div>
  );
}
