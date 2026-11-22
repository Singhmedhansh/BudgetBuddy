"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/server/admin";
import { isReviewer } from "@/server/ai/reviewers";
import { requireSpace } from "@/server/context";

/** Marks a thumbs-down answer as looked at. Only a reviewer can do it, and only on an answer the person marked down. */
export async function markReviewedAction(formData: FormData): Promise<void> {
  const ctx = await requireSpace();
  if (!isReviewer(ctx.user.email)) return;
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) return;
  const admin = createAdminClient();
  if (!admin) return;
  await admin
    .from("finn_messages")
    .update({ reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("feedback", "down");
  revalidatePath("/app/finn-review");
}
