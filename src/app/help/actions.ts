"use server";

import { z } from "zod";
import { bySlug } from "@/content/help/articles";
import { createClient } from "@/lib/supabase/server";

export interface FeedbackState {
  done?: boolean;
  error?: string;
}

export async function submitHelpFeedback(_: FeedbackState | undefined, form: FormData): Promise<FeedbackState> {
  const parsed = z
    .object({ slug: z.string().refine((s) => !!bySlug(s), "Unknown article."), helpful: z.enum(["yes", "no"]), comment: z.string().max(1000).optional() })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "That did not send. Try again." };
  const supabase = await createClient();
  if (!supabase) return { error: "Feedback is not available right now." };
  const { error } = await supabase.rpc("submit_help_feedback", {
    p_slug: parsed.data.slug,
    p_helpful: parsed.data.helpful === "yes",
    p_comment: parsed.data.comment?.trim() || null,
  });
  if (error) return { error: error.message.includes("rate_limited") ? "Too much feedback right now. Try again later." : "That did not send. Try again." };
  return { done: true };
}
